// Transcript history kept ONLY in this browser (localStorage). Nothing is sent anywhere.
// Every read is validated, because stored data can be corrupted, edited or from an older version.
import { HISTORY_LIMIT } from '../config.js';

const KEY = 'linefeed.history.v1';

function isEntry(e) {
  return e && typeof e === 'object' && typeof e.id === 'string' && typeof e.videoId === 'string'
    && typeof e.createdAt === 'string' && Array.isArray(e.segments)
    && e.segments.every((s) => s && typeof s.text === 'string' && Number.isFinite(s.startMs) && Number.isFinite(s.endMs));
}

/** @param {Storage | {getItem: Function, setItem: Function}} [storage] */
export function loadHistory(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function write(entries, storage) {
  try {
    storage.setItem(KEY, JSON.stringify(entries));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'storage-full-or-blocked' };
  }
}

/** Saves a transcript, replacing an older copy of the same video and language. Newest first, capped. */
export function saveEntry(entry, storage = globalThis.localStorage) {
  const all = loadHistory(storage).filter((e) => !(e.videoId === entry.videoId && (e.lang ?? null) === (entry.lang ?? null)));
  const next = [entry, ...all].slice(0, HISTORY_LIMIT);
  const result = write(next, storage);
  return result.ok ? { ...result, entries: next } : { ...result, entries: all };
}

export function deleteEntry(id, storage = globalThis.localStorage) {
  const next = loadHistory(storage).filter((e) => e.id !== id);
  return { ...write(next, storage), entries: next };
}

export function clearHistory(storage = globalThis.localStorage) {
  try {
    storage.removeItem?.(KEY);
    if (!storage.removeItem) storage.setItem(KEY, '[]');
    return { ok: true, entries: [] };
  } catch {
    return { ok: false, entries: loadHistory(storage) };
  }
}

/** A saved copy answers a request only if the video AND the requested language (or "auto") match. */
export function findEntry(videoId, requestedLang = '', storage = globalThis.localStorage) {
  return loadHistory(storage).find((e) => e.videoId === videoId && (e.requestedLang ?? '') === (requestedLang ?? '')) ?? null;
}

export function newEntry({ videoId, url, lang, requestedLang = '', availableLangs, segments }) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    videoId, url, lang: lang ?? null, requestedLang: requestedLang ?? '', availableLangs: availableLangs ?? [],
    createdAt: new Date().toISOString(),
    segments,
  };
}
