// One error type for everything the API intentionally returns. Anything else becomes a generic 500.

const STATUS = Object.freeze({
  VALIDATION_ERROR: 400,
  INVALID_JSON: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

export class AppError extends Error {
  /**
   * @param {string} code stable, machine-readable code (the frontend branches on this)
   * @param {string} message safe to show to the user; never put secrets or raw input in it
   * @param {{status?: number, details?: unknown, cause?: unknown}} [opts]
   */
  constructor(code, message, { status, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? STATUS[code] ?? 500;
    this.details = details;
  }
}

/** The error envelope from the API contract: { error: { code, message, details?, requestId } } */
export const errorBody = (code, message, requestId, details) => ({
  error: { code, message, ...(details === undefined ? {} : { details }), requestId },
});
