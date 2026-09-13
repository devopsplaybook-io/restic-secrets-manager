import {
  AuthGetUserSession,
  AuthMustBeAdmin,
} from "@devopsplaybook.io/common-utils";
import { FastifyInstance } from "fastify";
import { Project } from "../model/Project";
import { OTelRequestSpan } from "../OTelContext";
import {
  ProjectsDataGet,
  ProjectsDataGetByName,
  ProjectsDataAdd,
  ProjectsDataDelete,
  ProjectsDataList,
} from "./ProjectsData";
import { ProjectScopesAdd, ProjectScopesRemove } from "./ProjectScopes";
import {
  SecretsDataCountForProject,
  SecretsDataDeleteByProjectId,
} from "../secrets/SecretsData";
import { ProjectAccessCanAccess } from "../users/ProjectAccess";
import {
  ResticSyncError,
  ResticSyncPull,
  ResticSyncPush,
} from "../restic/SyncService";
import { Config } from "../Config";

export class ProjectsRoutes {
  //
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    const config = new Config();
    await config.reload();

    //
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const span = OTelRequestSpan(req);
      const projects = await ProjectsDataList(span);
      const visible: Record<string, unknown>[] = [];
      for (const project of projects) {
        if (
          userSession.role === "admin" ||
          (await ProjectAccessCanAccess(userSession, project.id))
        ) {
          visible.push({
            ...project.toTransportJson(),
            secretCount: await SecretsDataCountForProject(span, project.id),
          });
        }
      }
      return res.status(200).send({ projects: visible });
    });

    //
    fastify.post<{ Body: Record<string, unknown> }>("/", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const body = req.body || {};
      const errors = Project.validateNew(body);
      if (errors.length > 0) {
        return res.status(400).send({ error: errors.join(" ") });
      }
      if (
        await ProjectsDataGetByName(OTelRequestSpan(req), body.name as string)
      ) {
        return res
          .status(409)
          .send({ error: "A project with this name already exists" });
      }
      const project = Project.fromJson(body) as Project;
      await ProjectsDataAdd(OTelRequestSpan(req), project);
      ProjectScopesAdd(project.id);
      return res.status(201).send({ project: project.toTransportJson() });
    });

    //
    fastify.get<{ Params: { id: string } }>("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const project = await ProjectsDataGet(
        OTelRequestSpan(req),
        req.params.id,
      );
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      if (
        userSession.role !== "admin" &&
        !(await ProjectAccessCanAccess(userSession, project.id))
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const span = OTelRequestSpan(req);
      return res.status(200).send({
        project: {
          ...project.toTransportJson(),
          secretCount: await SecretsDataCountForProject(span, project.id),
        },
      });
    });

    // Projects are created or deleted but never updated
    fastify.put("/", async (_req, res) => {
      return res.status(405).send({ error: "Projects cannot be updated" });
    });

    //
    fastify.delete<{ Params: { id: string } }>("/:id", async (req, res) => {
      try {
        await AuthMustBeAdmin(req, res);
      } catch {
        return;
      }
      const span = OTelRequestSpan(req);
      const project = await ProjectsDataGet(span, req.params.id);
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      await SecretsDataDeleteByProjectId(span, project.id);
      await ProjectsDataDelete(span, project.id);
      ProjectScopesRemove(project.id);
      return res.status(200).send({});
    });

    //
    fastify.post<{ Params: { id: string } }>("/:id/pull", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const span = OTelRequestSpan(req);
      const project = await ProjectsDataGet(span, req.params.id);
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      if (
        userSession.role !== "admin" &&
        !(await ProjectAccessCanAccess(userSession, project.id))
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      try {
        const result = await ResticSyncPull(span, config, project);
        return res.status(200).send(result);
      } catch (e) {
        return sendSyncError(res, e);
      }
    });

    //
    fastify.post<{ Params: { id: string } }>("/:id/push", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const span = OTelRequestSpan(req);
      const project = await ProjectsDataGet(span, req.params.id);
      if (!project) {
        return res.status(404).send({ error: "Project Not Found" });
      }
      if (
        userSession.role !== "admin" &&
        !(await ProjectAccessCanAccess(userSession, project.id))
      ) {
        return res.status(403).send({ error: "Access Denied" });
      }
      try {
        const result = await ResticSyncPush(span, config, project);
        return res.status(200).send(result);
      } catch (e) {
        return sendSyncError(res, e);
      }
    });
  }
}

/** Maps restic synchronization errors to transport responses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendSyncError(res: any, e: unknown) {
  if (e instanceof ResticSyncError) {
    return res.status(e.statusCode).send({ error: e.message });
  }
  return res.status(500).send({
    error: e instanceof Error ? e.message : "Internal Error",
  });
}
