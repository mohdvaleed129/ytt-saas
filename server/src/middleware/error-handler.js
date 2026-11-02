// Turns every failure into the API's error envelope. Unknown errors never leak their message or stack.
import { AppError, errorBody } from '../lib/errors.js';

export function notFoundHandler(req, res, next) {
  next(new AppError('NOT_FOUND', 'Route not found.'));
}

export function errorHandler(logger) {
  // Express identifies error middleware by its four parameters; `next` must stay in the signature.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    let status;
    let code;
    let message;
    let details;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err?.type === 'entity.too.large') {
      [status, code, message] = [413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'];
    } else if (err?.type === 'entity.parse.failed') {
      [status, code, message] = [400, 'INVALID_JSON', 'The request body is not valid JSON.'];
    } else if (err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
      [status, code, message] = [415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content encoding.'];
    } else {
      [status, code, message] = [500, 'INTERNAL_ERROR', 'Something went wrong on our side.'];
    }

    if (status >= 500) logger.error({ requestId: req.id, err, method: req.method, path: req.path }, 'unhandled error');

    res.status(status).set('Cache-Control', 'no-store').json(errorBody(code, message, req.id, details));
    return undefined;
  };
}
