// Runtime configuration. Everything environment-specific comes from Vite env variables (VITE_*),
// which are PUBLIC: they are compiled into the browser bundle. Never put a secret here.

// `import.meta.env` exists under Vite; plain Node (used by the unit tests) has none, so fall back to {}.
const env = import.meta.env ?? {};

/** Working product name. Change it here only; the brand is not final. */
export const APP_NAME = 'Transcripto';

/** Base URL of the backend API, without a trailing slash. Empty means "not configured". */
export const API_URL = String(env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

/** Show the clearly labelled sample-transcript button (useful while the backend cannot run). */
export const ENABLE_SAMPLE = String(env.VITE_ENABLE_SAMPLE ?? '').toLowerCase() === 'true';

/** How long the browser waits for the API before giving up (ms). Provider answers took up to ~30 s in testing. */
export const REQUEST_TIMEOUT_MS = 90_000;

/** Number of transcripts kept in this browser's history. */
export const HISTORY_LIMIT = 20;
