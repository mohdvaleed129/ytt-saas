// Every request gets an ID. A caller-supplied X-Request-Id is accepted only if it is short and
// plain (so it cannot be used for log injection); otherwise we generate one.
import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId() {
  return (req, res, next) => {
    const supplied = req.get('x-request-id');
    req.id = supplied && SAFE_ID.test(supplied) ? supplied : randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  };
}
