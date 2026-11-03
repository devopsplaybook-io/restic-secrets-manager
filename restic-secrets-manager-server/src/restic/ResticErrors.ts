/**
 * Restic synchronization failure carrying the HTTP status code to return to
 * the client (404 empty repository, 409 conflict, 499 client disconnect,
 * 504 timeout, ...).
 */
export class ResticSyncError extends Error {
  public statusCode: number;
  /** Stable machine-readable code sent alongside the message. */
  public code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "ResticSyncError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
