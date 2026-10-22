/**
 * Restic synchronization failure carrying the HTTP status code to return to
 * the client (404 empty repository, 409 conflict, 499 client disconnect,
 * 504 timeout, ...).
 */
export class ResticSyncError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ResticSyncError";
    this.statusCode = statusCode;
  }
}
