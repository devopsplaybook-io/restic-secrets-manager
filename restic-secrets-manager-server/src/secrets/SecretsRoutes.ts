import { FastifyInstance } from "fastify";
import { Secret, SecretData } from "../model/Secret";
import { OTelRequestSpan } from "../OTelContext";
import {
  SecretsDataAdd,
  SecretsDataDelete,
  SecretsDataGet,
  SecretsDataGetByName,
  SecretsDataListForProject,
  SecretsDataUpdateData,
} from "./SecretsData";
import { ProjectAccessEnsure } from "../users/ProjectAccess";

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
        await ProjectAccessEnsure(req, res, req.params.id);
        const secrets = await SecretsDataListForProject(
          OTelRequestSpan(req),
          req.params.id,
        );
        return res
          .status(200)
          .send({ secrets: secrets.map((s) => s.toJson()) });
      },
    );

    //
    fastify.post<{
      Params: { id: string };
      Body: { name?: string; data?: SecretData };
    }>("/:id/secrets", async (req, res) => {
      await ProjectAccessEnsure(req, res, req.params.id);
      const body = req.body || ({} as Record<string, unknown>);
      const name = (body.name as string) || "";
      const errors = Secret.validate(name, body.data);
      if (errors.length > 0) {
        return res.status(400).send({ error: errors.join(" ") });
      }
      if (
        await SecretsDataGetByName(OTelRequestSpan(req), req.params.id, name)
      ) {
        return res
          .status(409)
          .send({ error: "A secret with this name already exists" });
      }
      const secret = new Secret();
      secret.projectId = req.params.id;
      secret.name = name;
      secret.data = Secret.normalizeData(body.data);
      await SecretsDataAdd(OTelRequestSpan(req), secret);
      return res.status(201).send({ secret: secret.toJson() });
    });

    //
    fastify.put<{
      Params: { id: string; secretId: string };
      Body: { data?: SecretData };
    }>("/:id/secrets/:secretId", async (req, res) => {
      await ProjectAccessEnsure(req, res, req.params.id);
      const secret = await SecretsDataGet(
        OTelRequestSpan(req),
        req.params.secretId,
      );
      if (!secret || secret.projectId !== req.params.id) {
        return res.status(404).send({ error: "Secret Not Found" });
      }
      const errors = Secret.validate(secret.name, req.body?.data);
      if (errors.length > 0) {
        return res.status(400).send({ error: errors.join(" ") });
      }
      secret.data = Secret.normalizeData(req.body?.data);
      await SecretsDataUpdateData(OTelRequestSpan(req), secret);
      return res.status(200).send({ secret: secret.toJson() });
    });

    //
    fastify.delete<{ Params: { id: string; secretId: string } }>(
      "/:id/secrets/:secretId",
      async (req, res) => {
        await ProjectAccessEnsure(req, res, req.params.id);
        const secret = await SecretsDataGet(
          OTelRequestSpan(req),
          req.params.secretId,
        );
        if (!secret || secret.projectId !== req.params.id) {
          return res.status(404).send({ error: "Secret Not Found" });
        }
        await SecretsDataDelete(OTelRequestSpan(req), secret.id);
        return res.status(200).send({});
      },
    );
  }
}
