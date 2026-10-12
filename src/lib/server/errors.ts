export const ERROR_STATUS = {
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  AMBIGUOUS_PLACE: 409,
  OUT_OF_CAMPUS: 422,
  ROUTE_UNAVAILABLE: 422,
  INSUFFICIENT_DATA: 503,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFIRMATION_REQUIRED: 409,
  UNSUPPORTED_INTEGRATION: 503,
  SERVICE_UNAVAILABLE: 503,
  UPSTREAM_ERROR: 502,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
