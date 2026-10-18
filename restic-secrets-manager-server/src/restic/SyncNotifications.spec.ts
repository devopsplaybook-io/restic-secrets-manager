import { Project } from "../model/Project";
import {
  SyncNotificationsInit,
  SyncNotificationsNotify,
} from "./SyncNotifications";

jest.mock("@devopsplaybook.io/common-utils", () => ({
  NotificationsClient: jest.fn(),
}));

jest.mock("../OTelContext", () => ({
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }),
}));

import { NotificationsClient } from "@devopsplaybook.io/common-utils";

const clientConstructorMock = NotificationsClient as jest.Mock;

function projectFixture(): Project {
  const project = new Project();
  project.id = "p1";
  project.name = "Test Project";
  return project;
}

function sendMock(): jest.Mock {
  return clientConstructorMock.mock.results[0].value.send;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SyncNotificationsInit", () => {
  it("should not construct a client when the integration is not configured", () => {
    const config = {
      NOTIFICATIONS_API_ENDPOINT: "",
      NOTIFICATIONS_API_TOKEN: "",
    } as any;
    SyncNotificationsInit(config);
    expect(clientConstructorMock).not.toHaveBeenCalled();
  });

  it("should construct the client with the configured endpoint and token", () => {
    const config = {
      NOTIFICATIONS_API_ENDPOINT: "https://notifications.example.com/api/notifications",
      NOTIFICATIONS_API_TOKEN: "secret-token",
    } as any;
    clientConstructorMock.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue(null),
    }));
    SyncNotificationsInit(config);
    expect(clientConstructorMock).toHaveBeenCalledTimes(1);
    expect(clientConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiEndpoint: "https://notifications.example.com/api/notifications",
        apiToken: "secret-token",
      }),
    );
  });
});

describe("SyncNotificationsNotify", () => {
  it("should not send anything when the integration is disabled", () => {
    SyncNotificationsInit({
      NOTIFICATIONS_API_ENDPOINT: "",
      NOTIFICATIONS_API_TOKEN: "",
    } as any);
    SyncNotificationsNotify("push", projectFixture(), "alice", "snap-1");
    expect(clientConstructorMock).not.toHaveBeenCalled();
  });

  it("should map a push event to an info payload", () => {
    clientConstructorMock.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue(null),
    }));
    SyncNotificationsInit({
      NOTIFICATIONS_API_ENDPOINT: "https://notifications.example.com",
      NOTIFICATIONS_API_TOKEN: "secret-token",
    } as any);
    SyncNotificationsNotify("push", projectFixture(), "alice", "snap-1");
    expect(sendMock()).toHaveBeenCalledTimes(1);
    const payload = sendMock().mock.calls[0][0];
    expect(payload.title).toBe("Secrets pushed: Test Project");
    expect(payload.source).toBe("restic-secrets-manager");
    expect(payload.severity).toBe("info");
    expect(JSON.parse(payload.data)).toEqual({
      event: "push",
      projectId: "p1",
      projectName: "Test Project",
      snapshotId: "snap-1",
      actor: "alice",
    });
  });

  it("should map the other sync events to their titles", () => {
    clientConstructorMock.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue(null),
    }));
    SyncNotificationsInit({
      NOTIFICATIONS_API_ENDPOINT: "https://notifications.example.com",
      NOTIFICATIONS_API_TOKEN: "secret-token",
    } as any);
    SyncNotificationsNotify("pull", projectFixture(), "alice", "snap-1");
    SyncNotificationsNotify("restore", projectFixture(), "alice", "snap-2");
    SyncNotificationsNotify("discard", projectFixture(), "alice", "snap-3");
    const titles = sendMock().mock.calls.map((call) => call[0].title);
    expect(titles).toEqual([
      "Secrets pulled: Test Project",
      "Snapshot restored: Test Project",
      "Local changes discarded: Test Project",
    ]);
  });

  it("should send push conflicts as warnings without a snapshot", () => {
    clientConstructorMock.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue(null),
    }));
    SyncNotificationsInit({
      NOTIFICATIONS_API_ENDPOINT: "https://notifications.example.com",
      NOTIFICATIONS_API_TOKEN: "secret-token",
    } as any);
    SyncNotificationsNotify("push_conflict", projectFixture(), "alice");
    const payload = sendMock().mock.calls[0][0];
    expect(payload.title).toBe("Push conflict: Test Project");
    expect(payload.severity).toBe("warning");
    expect(JSON.parse(payload.data).snapshotId).toBeNull();
  });

  it("should carry no secret value in the payload", () => {
    clientConstructorMock.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue(null),
    }));
    SyncNotificationsInit({
      NOTIFICATIONS_API_ENDPOINT: "https://notifications.example.com",
      NOTIFICATIONS_API_TOKEN: "secret-token",
    } as any);
    SyncNotificationsNotify("push", projectFixture(), "alice", "snap-1");
    const payload = sendMock().mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain("secretValue");
  });

  it("should never propagate a send rejection", async () => {
    clientConstructorMock.mockImplementation(() => ({
      send: jest.fn().mockRejectedValue(new Error("network down")),
    }));
    SyncNotificationsInit({
      NOTIFICATIONS_API_ENDPOINT: "https://notifications.example.com",
      NOTIFICATIONS_API_TOKEN: "secret-token",
    } as any);
    expect(() =>
      SyncNotificationsNotify("push", projectFixture(), "alice", "snap-1"),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("should be fire-and-forget: not await the send", () => {
    clientConstructorMock.mockImplementation(() => ({
      send: jest.fn().mockImplementation(
        () => new Promise(() => {}), // never resolves
      ),
    }));
    SyncNotificationsInit({
      NOTIFICATIONS_API_ENDPOINT: "https://notifications.example.com",
      NOTIFICATIONS_API_TOKEN: "secret-token",
    } as any);
    expect(() =>
      SyncNotificationsNotify("push", projectFixture(), "alice", "snap-1"),
    ).not.toThrow();
  });
});
