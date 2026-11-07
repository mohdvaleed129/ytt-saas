import { Fragment } from 'react';
import { findMatches, formatTimestamp, isNonSpeech } from '../../lib/transcript-format.js';
import { youtubeTimeUrl } from '../../lib/youtube.js';

function Highlighted({ text, query }) {
  const ranges = findMatches(text, query);
  if (!ranges.length) return text;
  const parts = [];
  let last = 0;
  ranges.forEach(([a, b], i) => {
    if (a > last) parts.push(<Fragment key={`t${i}`}>{text.slice(last, a)}</Fragment>);
    parts.push(<mark key={`m${i}`}>{text.slice(a, b)}</mark>);
    last = b;
  });
  if (last < text.length) parts.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  return parts;
}

/**
 * @param {{rows: {segment: {startMs:number,endMs:number,text:string}, index: number}[], query: string,
 *          videoId: string|null, linkable: boolean, lang: string|null, animate: boolean}} props
 */
export default function SegmentList({ rows, query, videoId, linkable, lang, animate }) {
  return (
    <ol className={`segments${animate ? ' segments--print' : ''}`} lang={lang || undefined}>
      {rows.map(({ segment, index }, i) => {
        const time = formatTimestamp(segment.startMs);
        return (
          <li key={index} className={`segments__row${isNonSpeech(segment.text) ? ' segments__row--sound' : ''}`} style={animate && i < 28 ? { '--i': i } : undefined}>
            {linkable && videoId ? (
              <a className="segments__time" href={youtubeTimeUrl(videoId, segment.startMs)} target="_blank" rel="noopener noreferrer"
                aria-label={`${time}. Open the video at this time (new tab)`}>{time}</a>
            ) : (
              <span className="segments__time">{time}</span>
            )}
            <span className="segments__text" dir="auto"><Highlighted text={segment.text} query={query} /></span>
          </li>
        );
      })}
    </ol>
  );
}
