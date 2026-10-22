import type { IncomingMessage, ServerResponse } from "http";

/**
 * AbortSignal that aborts when the HTTP response closes before it was
 * completely written (client disconnect) or when the request was already
 * destroyed. Long-running restic operations receive it so they can stop
 * instead of running without a consumer.
 */
export function RequestAbortSignal(
  req: IncomingMessage,
  res: ServerResponse,
): AbortSignal {
  const controller = new AbortController();
  const abortIfIncomplete = () => {
    if (!res.writableEnded && !controller.signal.aborted) {
      controller.abort();
    }
  };
  if (req.destroyed || res.destroyed) {
    controller.abort();
    return controller.signal;
  }
  res.once("close", abortIfIncomplete);
  return controller.signal;
}
