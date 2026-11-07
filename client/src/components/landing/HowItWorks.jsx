const STOPS = [
  { title: 'Paste the link', body: 'A normal video link, a Shorts link or a youtu.be link. The link is checked before anything is sent.' },
  { title: 'We ask for its captions', body: 'The server asks for the captions the video already has. Nothing is generated or guessed. If there are none, you are told so.' },
  { title: 'Read, search, take it with you', body: 'Search the text, click a time to jump to that moment on YouTube, then copy it or download TXT or SRT.' },
];

export default function HowItWorks() {
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <div className="container route">
        <div className="route__intro">
          <h2 id="how-title">Three stops</h2>
          <p>From link to text, with nothing in between that you did not ask for.</p>
        </div>
        <ol className="route__line">
          {STOPS.map((s, i) => (
            <li key={s.title} className="route__stop">
              <span className="route__marker" aria-hidden="true">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
