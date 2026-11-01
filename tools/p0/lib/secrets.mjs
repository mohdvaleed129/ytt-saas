// Shared secret detection and redaction for the P0 tools.
// Rule: nothing that could contain a secret value is ever printed. Every output line goes
// through redactLine(), and the final output is checked by assertNoLeak() before it is shown.

export const SECRET_PATTERNS = [
  { id: 'supadata-api-key', re: /\bsd_[A-Za-z0-9]{16,}\b/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: 'razorpay-key-id', re: /\brzp_(?:live|test)_[A-Za-z0-9]{8,}\b/g },
  { id: 'mongodb-uri-credentials', re: /mongodb(?:\+srv)?:\/\/[^\s:/@]+:[^\s@]+@/g },
  { id: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
];

const PLACEHOLDER = /^(?:your[_ -].*|<.*>|change[_-]?me|example.*|x{3,}|\.{3}|todo|replace[_-].*)$/i;

/** @returns {'empty'|'placeholder'|'secret-like'|'other'} */
export function classifyValue(value) {
  const v = String(value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!v) return 'empty';
  if (PLACEHOLDER.test(v)) return 'placeholder';
  if (v.length >= 16 && !/\s/.test(v)) return 'secret-like';
  return 'other';
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

export function parseEnv(text) {
  return String(text)
    .split(/\r?\n/)
    .map((raw, i) => {
      const m = ASSIGNMENT.exec(raw);
      return m && !raw.trim().startsWith('#')
        ? { lineNo: i + 1, raw, name: m[1], value: m[2].replace(/^(['"])(.*)\1$/, '$2') }
        : { lineNo: i + 1, raw, name: null, value: null };
    });
}

/** Returns a copy of the line that is safe to print. */
export function redactLine(line) {
  let out = String(line);
  const m = ASSIGNMENT.exec(out);
  if (m && !out.trim().startsWith('#') && classifyValue(m[2]) === 'secret-like') {
    return `${m[1]}=<REDACTED len=${m[2].replace(/^(['"])(.*)\1$/, '$2').length}>`;
  }
  for (const { id, re } of SECRET_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), `<REDACTED:${id}>`);
  }
  return out;
}

/** Pattern ids that match the text (never the matched values). */
export function findSecretIds(text) {
  return SECRET_PATTERNS.filter(({ re }) => new RegExp(re.source, re.flags).test(text)).map((p) => p.id);
}

/** Collects the secret-like values from an env file so output can be checked against them. */
export function secretValuesOf(text) {
  return parseEnv(text)
    .filter((e) => e.name && classifyValue(e.value) === 'secret-like')
    .map((e) => e.value);
}

/** Defense in depth: refuse to emit output that contains any known secret value. */
export function assertNoLeak(output, secretValues) {
  for (const v of secretValues) {
    if (v.length >= 8 && output.includes(v)) {
      throw new Error('Internal safety stop: output would have contained a secret value. Nothing was printed.');
    }
  }
}

/** Minimal line diff (LCS). Inputs are small config files. */
export function lineDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: ' ', line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', line: a[i++] }); }
    else { out.push({ t: '+', line: b[j++] }); }
  }
  while (i < n) out.push({ t: '-', line: a[i++] });
  while (j < m) out.push({ t: '+', line: b[j++] });
  return out;
}
