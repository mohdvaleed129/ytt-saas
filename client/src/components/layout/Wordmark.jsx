import { APP_NAME } from '../../config.js';

/** Wordmark: a ticket with a notch, plus the name. Decorative glyph is hidden from assistive tech. */
export default function Wordmark() {
  return (
    <>
      <svg className="wordmark__glyph" viewBox="0 0 28 20" aria-hidden="true" focusable="false">
        <path d="M2 1h24a1 1 0 0 1 1 1v5a3 3 0 0 0 0 6v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-5a3 3 0 0 0 0-6V2a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 7h12M8 10h12M8 13h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>{APP_NAME}</span>
    </>
  );
}
