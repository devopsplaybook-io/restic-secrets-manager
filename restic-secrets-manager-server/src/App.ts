import { StandardMeter, StandardTracer } from "@devopsplaybook.io/otel-utils";
import { StandardTracerFastifyRegisterHooks } from "@devopsplaybook.io/otel-utils-fastify";
import {
  AuthInit,
  User,
  UsersDataList,
  UsersRoutes,
} from "@devopsplaybook.io/common-utils";
import fastifyCompress from "@fastify/compress";
import fastifyCors from "@fastify/cors";
import Fastify from "fastify";
import { watchFile } from "fs-extra";
import * as path from "path";
import { Config } from "./Config";
import {
  OTelLogger,
  OTelSetMeter,
  OTelSetTracer,
  OTelTracer,
} from "./OTelContext";
import { ProjectsRoutes } from "./projects/ProjectsRoutes";
import {
  ProjectScopesRefreshStart,
  ProjectScopesSync,
} from "./projects/ProjectScopes";
import { SecretsHashBackfillAll } from "./secrets/SecretsHash";
import { SecretsRoutes } from "./secrets/SecretsRoutes";
import { registerStaticFiles } from "./StaticCacheHeaders";
import { SyncNotificationsInit } from "./restic/SyncNotifications";
import { cleanupStaleWorkDirs } from "./restic/TempWorkDir";
import { AuthWiringSetOTel } from "./users/AuthWiring";
import { DbUtilsSetOTel } from "./utils-std-ts/DbUtils";
import { DbInit } from "./utils-std-ts/DbInit";

const logger = OTelLogger().createModuleLogger("app");

logger.info("====== Starting restic-secrets-manager Server ======");

Promise.resolve().then(async () => {
  //
  const config = new Config();
  await config.reload();
  watchFile(config.CONFIG_FILE, async () => {
    logger.info(`Configuration file changed: ${config.CONFIG_FILE}`);
    try {
      // reload() mutates this instance in place: the route handlers and the
      // restic helpers read the new values on their next request, so the
      // documented hot-reloadable settings (restic timeouts, TMP_DIR and
      // notifications) apply without a restart.
      await config.reload();
      SyncNotificationsInit(config);
      logger.info(
        `Configuration reloaded: ${config.CONFIG_FILE} (restic timeouts, TMP_DIR and sync notifications applied)`,
      );
    } catch (e) {
      logger.error("Failed to reload the configuration", e);
    }
  });

  OTelSetTracer(new StandardTracer(config));
  OTelSetMeter(new StandardMeter(config));
  OTelLogger().initOTel(config);

  SyncNotificationsInit(config);

  DbUtilsSetOTel(OTelTracer(), OTelLogger());

  const span = OTelTracer().startSpan("init");

  await DbInit(span, config);
  AuthWiringSetOTel(OTelTracer());

  // User scopes are the dynamic project access scopes
  await ProjectScopesSync();
  // One-time backfill of the stored secrets content hashes (L10 upgrade)
  await SecretsHashBackfillAll(span);
  await AuthInit(span, config, [...User.ALL_SCOPES]);
  // AuthInit overwrites ALL_SCOPES with the startup list: keep it aligned
  // with the projects created or deleted by other replicas from now on
  ProjectScopesRefreshStart();

  span.end();

  // Remove plaintext working directories left behind by a crash
  const staleWorkDirs = await cleanupStaleWorkDirs(config.TMP_DIR);
  if (staleWorkDirs > 0) {
    logger.info(`Removed ${staleWorkDirs} stale restic working director${staleWorkDirs === 1 ? "y" : "ies"}`);
  }

  // APIs

  const fastify = Fastify({
    logger: {
      level: "error",
    },
    trustProxy: config.TRUST_PROXY,
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

  // Register API routes
  await fastify.register(
    async (instance) => {
      await new UsersRoutes().getRoutes(instance);
    },
    { prefix: "/api/users" },
  );

  await fastify.register(
    async (instance) => {
      await new ProjectsRoutes().getRoutes(instance, config);
    },
    { prefix: "/api/projects" },
  );

  await fastify.register(
    async (instance) => {
      await new SecretsRoutes().getRoutes(instance);
    },
    { prefix: "/api/projects" },
  );

  await registerStaticFiles(fastify, path.join(__dirname, "../web"));

  fastify.setNotFoundHandler((request, reply) => {
    if (
      request.raw.url &&
      !request.raw.url.startsWith("/api/") &&
      !path.extname(request.raw.url)
    ) {
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
