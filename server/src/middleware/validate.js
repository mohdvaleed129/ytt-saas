// Zod request validation. Validated values go on req.valid (Express 5 makes req.query read-only).
// Error details contain the location, field path, rule code and message, and never the submitted value.
import { AppError } from '../lib/errors.js';

export function validate({ body, query, params }) {
  return (req, res, next) => {
    const valid = {};
    const details = [];
    for (const [location, schema, input] of [
      ['body', body, req.body],
      ['query', query, req.query],
      ['params', params, req.params],
    ]) {
      if (!schema) continue;
      const result = schema.safeParse(input);
      if (result.success) valid[location] = result.data;
      else {
        for (const issue of result.error.issues) {
          details.push({ location, path: issue.path.join('.'), code: issue.code, message: issue.message });
        }
      }
    }
    if (details.length) return next(new AppError('VALIDATION_ERROR', 'The request is not valid.', { details }));
    req.valid = valid;
    return next();
  };
}
