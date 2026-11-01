const segments = [
  { text: "First sentence", offset: 0, duration: 5000 },
  { text: "Second sentence", offset: 4000, duration: 4000 },
  { text: "Third sentence", offset: 6000, duration: 3000 },
  { text: "Fourth sentence", offset: 10000, duration: 2000 },
];

const overlappingSegments = [];

const sortedSegments = [...segments].sort(
  (a, b) => a.offset - b.offset
);

for (let i = 0; i < sortedSegments.length; i++) {
  const current = sortedSegments[i];
  const currentEnd = current.offset + current.duration;

  for (let j = i + 1; j < sortedSegments.length; j++) {
    const next = sortedSegments[j];

    if (next.offset >= currentEnd) break;

    overlappingSegments.push({
      previous: {
        text: current.text,
        startMs: current.offset,
        endMs: currentEnd,
      },
      current: {
        text: next.text,
        startMs: next.offset,
        endMs: next.offset + next.duration,
      },
      overlapMs: currentEnd - next.offset,
    });
  }
}

console.log(JSON.stringify(overlappingSegments, null, 2));