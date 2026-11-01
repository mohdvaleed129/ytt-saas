import { readFile, writeFile } from 'node:fs/promises';
import {
  analyzeSegments,
  normalizeSegments,
  toSrt,
  toTxt,
} from './transcript-format.js';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node src/analyze-saved.js <transcript-json>');
  process.exit(1);
}

async function main() {
  const data = JSON.parse(await readFile(file, 'utf8'));

  const stats = analyzeSegments(
    data.segments,
    data.durationSec
  );

  const normalized = normalizeSegments(data.segments);

  const srt = toSrt(normalized);
  const txt = toTxt(normalized);

  await writeFile(file.replace('.json', '.srt'), srt);
  await writeFile(file.replace('.json', '.txt'), txt);

  console.log('\nTRANSCRIPT QUALITY REPORT');
  console.log('-------------------------');
  console.log('Video:', data.title);
  console.log('Language:', data.language);
  console.log('Statistics:', stats);
  console.log('SRT segments:', normalized.length);
  console.log('SRT and TXT files exported successfully.');
}

main().catch((err) => {
  console.error('Analysis failed:', err.message);
  process.exit(1);
});