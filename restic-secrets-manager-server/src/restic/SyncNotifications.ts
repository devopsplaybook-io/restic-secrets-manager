import { NotificationsClient } from "@devopsplaybook.io/common-utils";
import { Config } from "../Config";
import { Project } from "../model/Project";
import { OTelLogger } from "../OTelContext";

const logger = OTelLogger().createModuleLogger("notifications");

export type SyncNotificationEvent =
  | "push"
  | "pull"
  | "restore"
  | "discard"
  | "push_conflict";

const EVENT_TITLES: Record<SyncNotificationEvent, string> = {
  push: "Secrets pushed",
  pull: "Secrets pulled",
  restore: "Snapshot restored",
  discard: "Local changes discarded",
  push_conflict: "Push conflict",
};

const EVENT_BODIES: Record<SyncNotificationEvent, (actor: string) => string> = {
  push: (actor) => `Project secrets pushed to the restic repository by ${actor}.`,
  pull: (actor) =>
    `Project secrets pulled from the restic repository by ${actor}.`,
  restore: (actor) => `Snapshot restored as project secrets by ${actor}.`,
  discard: (actor) =>
    `Local changes discarded (last synchronized snapshot restored) by ${actor}.`,
  push_conflict: () =>
    "Push rejected: the repository holds a more recent snapshot (pull first).",
};

let client: NotificationsClient | null = null;

export function SyncNotificationsInit(config: Config): void {
  const endpoint = config.NOTIFICATIONS_API_ENDPOINT;
  const token = config.NOTIFICATIONS_API_TOKEN;
  client =
    endpoint && token
      ? new NotificationsClient({ apiEndpoint: endpoint, apiToken: token, logger })
      : null;
  logger.info(
    client
      ? "Sync notifications enabled"
      : "Sync notifications disabled (NOTIFICATIONS_API_ENDPOINT/NOTIFICATIONS_API_TOKEN not set)",
  );
}

/**
 * Fire-and-forget notification of a sync event: never awaited by the
 * callers, never throws, carries no secret value.
 */
export function SyncNotificationsNotify(
  event: SyncNotificationEvent,
  project: Project,
  actor: string,
  snapshotId?: string,
): void {
  if (!client) {
    return;
  }
  const payload = {
    title: `${EVENT_TITLES[event]}: ${project.name}`,
    body: EVENT_BODIES[event](actor),
    source: "restic-secrets-manager",
    severity: event === "push_conflict" ? ("warning" as const) : ("info" as const),
    data: JSON.stringify({
      event,
      projectId: project.id,
      projectName: project.name,
      snapshotId: snapshotId ?? null,
      actor,
    }),
  };
  client
    .send(payload)
    .catch((e) =>
      logger.error("Failed to send the sync notification", e),
    );
}
