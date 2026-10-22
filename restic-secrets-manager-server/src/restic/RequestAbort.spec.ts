import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";
import { RequestAbortSignal } from "./RequestAbort";

function fakeExchange(overrides: { reqDestroyed?: boolean } = {}) {
  const req = new EventEmitter() as unknown as IncomingMessage;
  const res = new EventEmitter() as unknown as ServerResponse;
  Object.defineProperty(req, "destroyed", {
    value: overrides.reqDestroyed ?? false,
  });
  Object.defineProperty(res, "destroyed", { value: false });
  let ended = false;
  Object.defineProperty(res, "writableEnded", {
    get: () => ended,
  });
  return {
    req,
    res,
    finish: () => {
      ended = true;
      res.emit("close");
    },
  };
}

describe("RequestAbortSignal", () => {
  it("should abort when the response closes before it is complete", () => {
    const { req, res } = fakeExchange();
    const signal = RequestAbortSignal(req, res);

    expect(signal.aborted).toBe(false);
    res.emit("close");
    expect(signal.aborted).toBe(true);
  });

  it("should not abort when the response completed normally", () => {
    const { req, res, finish } = fakeExchange();
    const signal = RequestAbortSignal(req, res);

    finish();
    expect(signal.aborted).toBe(false);
  });

  it("should abort immediately when the request was already destroyed", () => {
    const { req, res } = fakeExchange({ reqDestroyed: true });
    expect(RequestAbortSignal(req, res).aborted).toBe(true);
  });
});
