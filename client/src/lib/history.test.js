import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadHistory, saveEntry, deleteEntry, clearHistory, findEntry, newEntry } from './history.js';

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, raw: m };
}
const entry = (videoId, lang = 'en', requestedLang = '') => newEntry({ videoId, url: `https://youtu.be/${videoId}`, lang, requestedLang, availableLangs: [lang], segments: [{ startMs: 0, endMs: 1000, text: 'hi' }] });

test('save, load, find and delete round-trip', () => {
  const s = memoryStorage();
  const a = entry('aaaaaaaaaaa');
  assert.equal(saveEntry(a, s).ok, true);
  assert.equal(loadHistory(s).length, 1);
  assert.equal(findEntry('aaaaaaaaaaa', '', s).id, a.id);
  assert.equal(findEntry('aaaaaaaaaaa', 'en', s), null, 'a copy fetched with "auto" does not answer an explicit-language request');
  assert.equal(findEntry('aaaaaaaaaaa', 'fr', s), null);
  assert.equal(deleteEntry(a.id, s).entries.length, 0);
});

test('same video and language replaces the older copy; newest first; capped at 20', () => {
  const s = memoryStorage();
  saveEntry(entry('aaaaaaaaaaa'), s);
  saveEntry(entry('aaaaaaaaaaa'), s);
  assert.equal(loadHistory(s).length, 1);
  saveEntry(entry('aaaaaaaaaaa', 'hi'), s);
  assert.equal(loadHistory(s).length, 2);
  for (let i = 0; i < 25; i++) saveEntry(entry(`v${String(i).padStart(10, '0')}`), s);
  const all = loadHistory(s);
  assert.equal(all.length, 20);
  assert.equal(all[0].videoId, 'v0000000024');
});

test('corrupt or tampered storage never crashes: it is ignored or filtered', () => {
  assert.deepEqual(loadHistory(memoryStorage({ 'linefeed.history.v1': '{not json' })), []);
  assert.deepEqual(loadHistory(memoryStorage({ 'linefeed.history.v1': '{"a":1}' })), []);
  const good = entry('bbbbbbbbbbb');
  const mixed = JSON.stringify([good, { id: 1 }, null, { ...good, id: 'x', segments: [{ text: 5 }] }]);
  assert.deepEqual(loadHistory(memoryStorage({ 'linefeed.history.v1': mixed })).map((e) => e.id), [good.id]);
});

test('a full or blocked storage is reported, and existing data is kept', () => {
  const s = memoryStorage();
  saveEntry(entry('aaaaaaaaaaa'), s);
  s.setItem = () => { throw new DOMException('quota', 'QuotaExceededError'); };
  const r = saveEntry(entry('bbbbbbbbbbb'), s);
  assert.equal(r.ok, false);
  assert.equal(loadHistory(s).length, 1);
  assert.deepEqual(loadHistory(null), []);
});

test('clearHistory empties the list', () => {
  const s = memoryStorage();
  saveEntry(entry('aaaaaaaaaaa'), s);
  assert.deepEqual(clearHistory(s), { ok: true, entries: [] });
  assert.deepEqual(loadHistory(s), []);
});
