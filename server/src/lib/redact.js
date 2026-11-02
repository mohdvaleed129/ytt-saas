// Central place that makes text safe to log. Every error and URI that reaches a log goes through here.

const URI_USERINFO = /(mongodb(?:\+srv)?:\/\/)([^\s/@]+)@/gi;
const TOKEN_PATTERNS = [
  /\bsd_[A-Za-z0-9]{16,}\b/g, // Supadata
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google API key
  /\brzp_(?:live|test)_[A-Za-z0-9]{8,}\b/g, // Razorpay key id
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI style
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, // Authorization header values
];

export function scrubSecrets(text) {
  let out = String(text ?? '');
  out = out.replace(URI_USERINFO, '$1<redacted>@');
  for (const re of TOKEN_PATTERNS) out = out.replace(new RegExp(re.source, re.flags), '<redacted>');
  return out;
}

/** Describes a MongoDB URI without credentials or query string: safe to log. */
export function redactMongoUri(uri) {
  const m = /^(mongodb(?:\+srv)?):\/\/(?:([^@/]*)@)?([^/?]+)(\/[^?]*)?(?:\?.*)?$/i.exec(String(uri ?? ''));
  if (!m) return '<invalid mongodb uri>';
  const [, scheme, userinfo, hosts, dbPath] = m;
  return `${scheme}://${userinfo === undefined ? '' : '<redacted>@'}${hosts}${dbPath ?? ''}`;
}

/** Plain-object error representation with secrets scrubbed from message and stack. */
export function safeError(err) {
  if (!err || typeof err !== 'object') return { message: scrubSecrets(String(err)) };
  return {
    name: err.name,
    code: err.code,
    message: scrubSecrets(err.message),
    stack: err.stack ? scrubSecrets(err.stack) : undefined,
  };
}
