import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import {
  AuthInit,
  AuthSetOTel,
  User,
  UsersDataList,
  UsersDataSetOTel,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";
import fastifyCompress from "@fastify/compress";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { Config } from "./Config";
import { OTelLogger, OTelRequestSpan, OTelSetMeter, OTelSetTracer, OTelTracer } from "./OTelContext";
import { ProjectsDataList } from "./projects/ProjectsData";
import { ProjectsRoutes } from "./projects/ProjectsRoutes";
import { ProjectScopesSync } from "./projects/ProjectScopes";
import { SecretsRoutes } from "./secrets/SecretsRoutes";
import { DbUtilsInit, DbUtilsSetOTel } from "./utils-std-ts/DbUtils";

const logger = OTelLogger().createModuleLogger("app");

logger.info("====== Starting restic-secrets-manager Server ======");

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, () => {
    logger.info(`Config updated: ${config.CONFIG_FILE}`);
    config.reload();
  });

  OTelSetTracer(new StandardTracer(config));
  OTelSetMeter(new StandardMeter(config));
  OTelLogger().initOTel(config);

  DbUtilsSetOTel(OTelTracer(), OTelLogger());

  const span = OTelTracer().startSpan("init");

  await DbUtilsInit(
    span,
    config,
    path.join(__dirname, `../sql/${config.DATABASE_TYPE}`),
  );
  AuthSetOTel(OTelTracer());
  UsersDataSetOTel(OTelTracer());

  // User scopes are the dynamic project access scopes
  await ProjectScopesSync();
  await AuthInit(span, config, [...User.ALL_SCOPES]);

  span.end();

  // APIs

  const fastify = Fastify({
    logger: {
      level: "error",
    },
  });

  await fastify.register(fastifyCompress, {
    global: true,
    threshold: 1024,
    encodings: ["gzip", "deflate"],
  });

  if (config.CORS_POLICY_ORIGIN) {
    await fastify.register(fastifyCors, {
      origin: config.CORS_POLICY_ORIGIN,
      methods: "GET,PUT,POST,DELETE",
    });
  }

  StandardTracerFastifyRegisterHooks(fastify, OTelTracer(), OTelLogger(), {
    ignoreList: ["GET-/api/status", "GET-/api/status/initialization"],
  });

  fastify.get("/api/status", async () => {
    return { started: true };
  });

  fastify.get("/api/status/initialization", async (req, res) => {
    if ((await UsersDataList(undefined)).length === 0) {
      return res.status(200).send({ initialized: false });
    }
    return res.status(200).send({ initialized: true });
  });

  fastify.get("/api/status/projects", async (req, res) => {
    const projects = await ProjectsDataList(OTelRequestSpan(req));
    return res.status(200).send({ count: projects.length });
  });

  // Register API routes
  await fastify.register(
    async (instance) => {
      await new UsersRoutes().getRoutes(instance);
    },
    { prefix: "/api/users" },
  );

  await fastify.register(
    async (instance) => {
      await new ProjectsRoutes().getRoutes(instance);
    },
    { prefix: "/api/projects" },
  );

  await fastify.register(
    async (instance) => {
      await new SecretsRoutes().getRoutes(instance);
    },
    { prefix: "/api/projects" },
  );

  fastify.register(fastifyStatic, {
    root: path.join(__dirname, "../web"),
    prefix: "/",
    maxAge: "1d",
    etag: true,
    lastModified: true,
    immutable: true,
    cacheControl: true,
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url &&
      !request.raw.url.startsWith("/api/") &&
      !path.extname(request.raw.url)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (reply as any).sendFile("index.html");
    }
    reply.status(404).send({ error: "Not Found" });
  });

  fastify.listen({ port: config.API_PORT, host: "0.0.0.0" }, (err) => {
    if (err) {
      logger.error("Error starting API", err);
      process.exit(1);
    }
    logger.info("API Listening");
  });
});
