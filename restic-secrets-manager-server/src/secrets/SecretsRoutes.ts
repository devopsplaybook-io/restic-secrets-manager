import { isUniqueViolationError } from "@devopsplaybook.io/common-utils";
import { FastifyInstance } from "fastify";
import { Secret, SecretData } from "../model/Secret";
import { OTelRequestSpan } from "../OTelContext";
import {
  secretDataToEnvContent,
  secretDataToJsonContent,
  SecretEnvError,
} from "./SecretEnv";
import {
  SecretsDataAdd,
  SecretsDataDelete,
  SecretsDataGet,
  SecretsDataGetByName,
  SecretsDataListForProject,
  SecretsDataUpdate,
} from "./SecretsData";
import { ProjectAccessEnsure } from "../users/ProjectAccess";
import { SecretsHashRefreshForProject } from "./SecretsHash";
import { setSecretResponseHeaders } from "./SecretResponseHeaders";

/**
 * Secrets routes, registered under the /api/projects prefix.
 * All routes require access to the project (admin or granted user).
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
      const body = req.body || ({} as Record<string, unknown>);
      const name = (body.name as string) || "";
      const errors = Secret.validate(name, body.data);
      if (errors.length > 0) {
        return res.status(400).send({ error: errors.join(" ") });
      }
      if (
        await SecretsDataGetByName(OTelRequestSpan(req), req.params.id, name)
      ) {
        return secretNameConflict(res);
      }
      const secret = new Secret();
      secret.projectId = req.params.id;
      secret.name = name;
      secret.data = Secret.normalizeData(body.data);
      try {
        await SecretsDataAdd(OTelRequestSpan(req), secret);
      } catch (e) {
        if (isUniqueViolationError(e)) {
          return secretNameConflict(res);
        }
        throw e;
      }
      await SecretsHashRefreshForProject(OTelRequestSpan(req), req.params.id);
      setSecretResponseHeaders(res);
      return res.status(201).send({ secret: secret.toJson() });
    });

    //
    fastify.put<{
      Params: { id: string; secretId: string };
      Body: { name?: string; data?: SecretData; version?: unknown };
    }>("/:id/secrets/:secretId", async (req, res) => {
      if (!(await ProjectAccessEnsure(req, res, req.params.id))) {
        return;
      }
      const secret = await SecretsDataGet(
        OTelRequestSpan(req),
        req.params.secretId,
      );
      if (!secret || secret.projectId !== req.params.id) {
        return res.status(404).send({ error: "Secret Not Found" });
      }
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
      const newName = hasName ? (body.name as string) || "" : secret.name;
      const errors = Secret.validate(
        newName,
        hasData ? body.data : secret.data,
      );
      if (errors.length > 0) {
        return res.status(400).send({ error: errors.join(" ") });
      }
      if (newName !== secret.name) {
        const existing = await SecretsDataGetByName(
          OTelRequestSpan(req),
          req.params.id,
          newName,
        );
        if (existing && existing.id !== secret.id) {
          return secretNameConflict(res);
        }
      }
      secret.name = newName;
      if (hasData) {
        secret.data = Secret.normalizeData(body.data);
      }
      let status;
      try {
        status = await SecretsDataUpdate(
          OTelRequestSpan(req),
          secret,
          version,
        );
      } catch (e) {
        if (isUniqueViolationError(e)) {
          return secretNameConflict(res);
        }
        throw e;
      }
      if (status === "not_found") {
        return res.status(404).send({ error: "Secret Not Found" });
      }
      if (status === "version_conflict") {
        return res.status(409).send({
          error:
            "Secret was modified by another user: reload and re-apply your changes",
          code: "SECRET_VERSION_CONFLICT",
        });
      }
      await SecretsHashRefreshForProject(OTelRequestSpan(req), req.params.id);
      setSecretResponseHeaders(res);
      return res.status(200).send({ secret: secret.toJson() });
    });

    // Partial update of a single key: never replaces the rest of the map, so
    // copying a key cannot overwrite keys changed by another user.
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
      const secret = await SecretsDataGet(
        OTelRequestSpan(req),
        req.params.secretId,
      );
      if (!secret || secret.projectId !== req.params.id) {
        return res.status(404).send({ error: "Secret Not Found" });
      }
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
        return res
          .status(400)
          .send({ error: `Invalid secret: value for key '${key}' must be a scalar` });
      }
      const version = parseVersion(body.version);
      if (version === null) {
        return res.status(400).send({
          error: "Invalid secret: version is required (read the secret again)",
        });
      }
      secret.data = { ...secret.data, [key]: String(value) };
      let status;
      try {
        status = await SecretsDataUpdate(
          OTelRequestSpan(req),
          secret,
          version,
        );
      } catch (e) {
        if (isUniqueViolationError(e)) {
          return secretNameConflict(res);
        }
        throw e;
      }
      if (status === "not_found") {
        return res.status(404).send({ error: "Secret Not Found" });
      }
      if (status === "version_conflict") {
        return res.status(409).send({
          error:
            "Secret was modified by another user: reload and re-apply your changes",
          code: "SECRET_VERSION_CONFLICT",
        });
      }
      await SecretsHashRefreshForProject(OTelRequestSpan(req), req.params.id);
      setSecretResponseHeaders(res);
      return res.status(200).send({ secret: secret.toJson() });
    });

    //
    fastify.delete<{ Params: { id: string; secretId: string } }>(
      "/:id/secrets/:secretId",
      async (req, res) => {
        if (!(await ProjectAccessEnsure(req, res, req.params.id))) {
          return;
        }
        const secret = await SecretsDataGet(
          OTelRequestSpan(req),
          req.params.secretId,
        );
        if (!secret || secret.projectId !== req.params.id) {
          return res.status(404).send({ error: "Secret Not Found" });
        }
        await SecretsDataDelete(OTelRequestSpan(req), secret.id);
        await SecretsHashRefreshForProject(OTelRequestSpan(req), req.params.id);
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
