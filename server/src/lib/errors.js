export class HttpError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, "BAD_REQUEST", details);
export const unauthorized = (message = "Authentication required") => new HttpError(401, message, "UNAUTHORIZED");
export const forbidden = (message = "You do not have permission to do this") => new HttpError(403, message, "FORBIDDEN");
export const notFound = (message = "Not found") => new HttpError(404, message, "NOT_FOUND");
export const conflict = (message, details) => new HttpError(409, message, "CONFLICT", details);
