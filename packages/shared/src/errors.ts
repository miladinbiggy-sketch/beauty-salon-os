/** 统一业务错误：API 层按 code 映射 HTTP 状态，前端按 code 做双语提示。 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const err = {
  validation: (message: string, details?: unknown) => new AppError("VALIDATION", 400, message, details),
  unauthorized: (message = "Unauthorized") => new AppError("UNAUTHORIZED", 401, message),
  forbidden: (message = "Forbidden") => new AppError("FORBIDDEN", 403, message),
  notFound: (message = "Not found") => new AppError("NOT_FOUND", 404, message),
  conflict: (message: string, details?: unknown) => new AppError("CONFLICT", 409, message, details),
  rateLimited: (message = "Too many requests") => new AppError("RATE_LIMITED", 429, message),
  internal: (message = "Internal error") => new AppError("INTERNAL", 500, message),
};
