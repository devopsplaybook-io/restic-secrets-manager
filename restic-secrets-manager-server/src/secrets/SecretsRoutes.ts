import { isUniqueViolationError } from "@devopsplaybook.io/common-utils";
import { FastifyInstance } from "fastify";
import { Secret, SecretData } from "../model/Secret";
import { OTelRequestSpan } from "../OTelContext";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  secretDataToEnvContent,
  secretDataToJsonContent,
  SecretEnvError,
} from "./SecretEnv";
import {
  SecretsDataAdd,
  SecretsDataDelete,
  SecretsDataGetByName,
  SecretsDataListForProject,
  SecretsDataUpdate,
} from "./SecretsData";
import { ProjectAccessEnsure } from "../users/ProjectAccess";
import { computeSecretsHash } from "./SecretsHash";
import { setSecretResponseHeaders } from "./SecretResponseHeaders";
import { ProjectWriteLocksRun } from "../restic/SyncLocks";

const PARTIAL_UPDATE_ATTEMPTS = 3;

/**
 * Secrets routes, registered under the /api/projects prefix.
 * All routes require access to the project (admin or granted user).
 *
 * Every mutation runs under the project write lock: the secrets list is
 * read once, the change is applied in memory, and the mutation and the
 * project current-content hash are written in one transaction. A
 * concurrent pull/restore therefore cannot interleave with an edit and
 * leave a hash that does not match the stored content.
 */
export class SecretsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    //
    fastify.get<{ Params: { id: string } }>(
      "/:id/secrets",
      async (req, res) => {
        if (!(await ProjectAccessEnsure(req, res, req.params.id))) {
          return;
        }
        const secrets = await SecretsDataListForProject(
          OTelRequestSpan(req),
          req.params.id,
        );
        setSecretResponseHeaders(res);
        return res
          .status(200)
          .send({ secrets: secrets.map((s) => s.toJson()) });
      },
    );

    // Read-only export of one secret, by name, as .env or JSON text
    // (scripts consume secrets without the web UI)
    fastify.get<{
      Params: { id: string; name: string };
      Querystring: { format?: string };
    }>("/:id/secrets/by-name/:name/export", async (req, res) => {
      if (!(await ProjectAccessEnsure(req, res, req.params.id))) {
        return;
      }
      const secret = await SecretsDataGetByName(
        OTelRequestSpan(req),
        req.params.id,
        req.params.name,
      );
      if (!secret) {
        return res.status(404).send({ error: "Secret Not Found" });
      }
      const format = (req.query.format || "env").toLowerCase();
      if (format !== "env" && format !== "json") {
        return res
          .status(400)
          .send({ error: "Invalid format: env or json expected" });
      }
      if (format === "json") {
        setSecretResponseHeaders(res);
        return res
          .status(200)
          .header("content-type", "application/json")
          .send(secretDataToJsonContent(secret.data));
      }
      let content: string;
      try {
        content = secretDataToEnvContent(secret.data);
      } catch (e) {
        if (e instanceof SecretEnvError) {
          return res.status(400).send({ error: e.message });
        }
        throw e;
      }
      setSecretResponseHeaders(res);
      return res
        .status(200)
        .header("content-type", "text/plain; charset=utf-8")
        .send(content);
    });

    //
    fastify.post<{
      Params: { id: string };
      Body: { name?: string; data?: SecretData };
    }>("/:id/secrets", async (req, res) => {
      if (!(await ProjectAccessEnsure(req, res, req.params.id))) {
        return;
      }
      const span = OTelRequestSpan(req);
      const body = req.body || ({} as Record<string, unknown>);
      const name = (body.name as string) || "";
      const errors = Secret.validate(name, body.data);
      if (errors.length > 0) {
        return res.status(400).send({ error: errors.join(" ") });
      }
      try {
        const outcome = await ProjectWriteLocksRun(
          req.params.id,
          async () => {
            if (!(await ProjectsDataGet(span, req.params.id))) {
              return { status: "project_not_found" as const };
            }
            const secrets = await SecretsDataListForProject(
              span,
              req.params.id,
            );
            if (secrets.some((secret) => secret.name === name)) {
              return { status: "conflict" as const };
            }
            const secret = new Secret();
            secret.projectId = req.params.id;
            secret.name = name;
            secret.data = Secret.normalizeData(body.data);
            secrets.push(secret);
            await SecretsDataAdd(span, secret, computeSecretsHash(secrets));
            return { status: "created" as const, secret };
          },
          span,
        );
        if (outcome.status === "project_not_found") {
          return res.status(404).send({ error: "Project Not Found" });
        }
        if (outcome.status === "conflict") {
          return secretNameConflict(res);
        }
        setSecretResponseHeaders(res);
        return res.status(201).send({ secret: outcome.secret.toJson() });
      } catch (e) {
        if (isUniqueViolationError(e)) {
          return secretNameConflict(res);
        }
        throw e;
      }
    });

    //
    fastify.put<{
      Params: { id: string; secretId: string };
      Body: { name?: string; data?: SecretData; version?: unknown };
    }>("/:id/secrets/:secretId", async (req, res) => {
      if (!(await ProjectAccessEnsure(req, res, req.params.id))) {
        return;
      }
      const span = OTelRequestSpan(req);
      const body = req.body || ({} as Record<string, unknown>);
      const version = parseVersion(body.version);
      if (version === null) {
        return res.status(400).send({
          error: "Invalid secret: version is required (read the secret again)",
        });
      }
      const hasName = body.name !== undefined;
      const hasData = body.data !== undefined;
      if (!hasName && !hasData) {
        return res
          .status(400)
          .send({ error: "Invalid secret: name or data is required" });
      }
      try {
        const outcome = await ProjectWriteLocksRun(
          req.params.id,
          async () => {
            if (!(await ProjectsDataGet(span, req.params.id))) {
              return { status: "project_not_found" as const };
            }
            const secrets = await SecretsDataListForProject(
              span,
              req.params.id,
            );
            const secret = secrets.find(
              (candidate) => candidate.id === req.params.secretId,
            );
            if (!secret) {
              return { status: "secret_not_found" as const };
            }
            const newName = hasName
              ? (body.name as string) || ""
              : secret.name;
            const errors = Secret.validate(
              newName,
              hasData ? body.data : secret.data,
            );
            if (errors.length > 0) {
              return { status: "invalid" as const, errors };
            }
            if (
              newName !== secret.name &&
              secrets.some(
                (candidate) =>
                  candidate.id !== secret.id && candidate.name === newName,
              )
            ) {
              return { status: "conflict" as const };
            }
            secret.name = newName;
            if (hasData) {
              secret.data = Secret.normalizeData(body.data);
            }
            const status = await SecretsDataUpdate(
              span,
              secret,
              version,
              computeSecretsHash(secrets),
            );
            if (status === "updated") {
              return { status, secret };
            }
            if (status === "not_found") {
              return { status: "secret_not_found" as const };
            }
            return { status: "version_conflict" as const };
          },
          span,
        );
        if (outcome.status === "project_not_found") {
          return res.status(404).send({ error: "Project Not Found" });
        }
        if (outcome.status === "secret_not_found") {
          return res.status(404).send({ error: "Secret Not Found" });
        }
        if (outcome.status === "invalid") {
          return res.status(400).send({ error: outcome.errors.join(" ") });
        }
        if (outcome.status === "conflict") {
          return secretNameConflict(res);
        }
        if (outcome.status === "version_conflict") {
          return secretVersionConflict(res);
        }
        setSecretResponseHeaders(res);
        return res.status(200).send({ secret: outcome.secret.toJson() });
      } catch (e) {
        if (isUniqueViolationError(e)) {
          return secretNameConflict(res);
        }
        throw e;
      }
    });

    // Partial update of a single key: never replaces the rest of the map, so
    // copying a key cannot overwrite keys changed by another user. The key is
    // merged into the freshly read data under the write lock; a stale client
    // version is not a rejection criterion and concurrent updates of the same
    // key are last-writer-wins.
    fastify.put<{
      Params: { id: string; secretId: string };
      Body: {
        key?: unknown;
        value?: unknown;
        version?: unknown;
      };
    }>("/:id/secrets/:secretId/keys", async (req, res) => {
      if (!(await ProjectAccessEnsure(req, res, req.params.id))) {
        return;
      }
      const span = OTelRequestSpan(req);
      const body = req.body || ({} as Record<string, unknown>);
      const key = typeof body.key === "string" ? body.key.trim() : "";
      if (key.length === 0) {
        return res
          .status(400)
          .send({ error: "Invalid secret: key is required" });
      }
      const value = body.value;
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        return res.status(400).send({
          error: `Invalid secret: value for key '${key}' must be a scalar`,
        });
      }
      // Kept for API compatibility: the fresh read under the lock is
      // authoritative for a partial update.
      if (parseVersion(body.version) === null) {
        return res.status(400).send({
          error: "Invalid secret: version is required (read the secret again)",
        });
      }
      try {
        const outcome = await ProjectWriteLocksRun(
          req.params.id,
          async () => {
            if (!(await ProjectsDataGet(span, req.params.id))) {
              return { status: "project_not_found" as const };
            }
            // A non-cooperating writer (e.g. an old replica during a
            // rollout) can still change the row between our read and write:
            // retry the read/merge/update a bounded number of times.
            for (
              let attempt = 0;
              attempt < PARTIAL_UPDATE_ATTEMPTS;
              attempt++
            ) {
              const secrets = await SecretsDataListForProject(
                span,
                req.params.id,
              );
              const secret = secrets.find(
                (candidate) => candidate.id === req.params.secretId,
              );
              if (!secret) {
                return { status: "secret_not_found" as const };
              }
              secret.data = { ...secret.data, [key]: String(value) };
              const status = await SecretsDataUpdate(
                span,
                secret,
                secret.version,
                computeSecretsHash(secrets),
              );
              if (status === "updated") {
                return { status, secret };
              }
              if (status === "not_found") {
                return { status: "secret_not_found" as const };
              }
            }
            return { status: "version_conflict" as const };
          },
          span,
        );
        if (outcome.status === "project_not_found") {
          return res.status(404).send({ error: "Project Not Found" });
        }
        if (outcome.status === "secret_not_found") {
          return res.status(404).send({ error: "Secret Not Found" });
        }
        if (outcome.status === "version_conflict") {
          return secretVersionConflict(res);
        }
        setSecretResponseHeaders(res);
        return res.status(200).send({ secret: outcome.secret.toJson() });
      } catch (e) {
        if (isUniqueViolationError(e)) {
          return secretNameConflict(res);
        }
        throw e;
      }
    });

    //
    fastify.delete<{ Params: { id: string; secretId: string } }>(
      "/:id/secrets/:secretId",
      async (req, res) => {
        if (!(await ProjectAccessEnsure(req, res, req.params.id))) {
          return;
        }
        const span = OTelRequestSpan(req);
        const outcome = await ProjectWriteLocksRun(
          req.params.id,
          async () => {
            if (!(await ProjectsDataGet(span, req.params.id))) {
              return { status: "project_not_found" as const };
            }
            const secrets = await SecretsDataListForProject(
              span,
              req.params.id,
            );
            const secret = secrets.find(
              (candidate) => candidate.id === req.params.secretId,
            );
            if (!secret) {
              return { status: "secret_not_found" as const };
            }
            const remaining = secrets.filter(
              (candidate) => candidate.id !== secret.id,
            );
            await SecretsDataDelete(
              span,
              secret.id,
              req.params.id,
              computeSecretsHash(remaining),
            );
            return { status: "deleted" as const };
          },
          span,
        );
        if (outcome.status === "project_not_found") {
          return res.status(404).send({ error: "Project Not Found" });
        }
        if (outcome.status === "secret_not_found") {
          return res.status(404).send({ error: "Secret Not Found" });
        }
        return res.status(200).send({});
      },
    );
  }
}

function parseVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

function secretNameConflict(res: any) {
  return res.status(409).send({
    error: "A secret with this name already exists",
    code: "SECRET_NAME_CONFLICT",
  });
}

function secretVersionConflict(res: any) {
  return res.status(409).send({
    error:
      "Secret was modified by another user: reload and re-apply your changes",
    code: "SECRET_VERSION_CONFLICT",
  });
}
