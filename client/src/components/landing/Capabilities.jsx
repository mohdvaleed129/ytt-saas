const SUPPORTED = [
  ['Videos that have captions', 'Captions are retrieved as they exist on the video.'],
  ['YouTube Shorts', 'Shorts links are accepted like any video link.'],
  ['Choosing a caption language', 'When the video offers that language. The result says which one came back.'],
  ['Search, copy, TXT and SRT', 'SRT overlap trimming is on by default and can be switched off.'],
  ['A list in this browser', 'Your recent transcripts stay in your browser and can be deleted.'],
];
const PLANNED = [
  ['AI transcription for videos without captions', 'Not available yet. A video with no captions returns a clear message.'],
  ['Accounts and sign-in', 'Not available yet.'],
  ['Saving transcripts on the server', 'Not available yet. Nothing is stored for you on a server in this version.'],
  ['Usage limits, plans and payments', 'Not available yet.'],
];

function Board({ title, items, tone }) {
  return (
    <div className="board">
      <h3 className="board__title"><span className={`stamp stamp--${tone === 'ok' ? 'ok' : 'no'}`}>{tone === 'ok' ? 'Supported' : 'Planned'}</span> {title}</h3>
      <ul>
        {items.map(([name, note]) => (
          <li key={name} className="board__row">
            <span className="board__name">{name}</span>
            <span className="board__note">{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Capabilities() {
  return (
    <section className="section section--ink on-ink" id="capabilities" aria-labelledby="cap-title">
      <div className="container">
        <h2 id="cap-title">What works and what does not</h2>
        <p className="section__lead">Plainly, so you do not have to find out by trying.</p>
        <div className="board-grid">
          <Board title="Today" items={SUPPORTED} tone="ok" />
          <Board title="Later" items={PLANNED} tone="no" />
        </div>
      </div>
    </section>
  );
}
