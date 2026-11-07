const ITEMS = [
  ['Which videos work?', 'Videos and Shorts that already have captions available on YouTube. Auto-generated captions count too. Private, deleted or restricted videos cannot be read.'],
  ['What if a video has no captions?', 'You get a clear “No captions available” message. AI transcription for those videos is planned but is not available yet, so nothing is generated for you.'],
  ['Which languages can I get?', 'Whatever caption languages the video has. Pick one or leave Auto. If the language you pick does not exist, the result shows which language came back. Each language is a separate request.'],
  ['Is my transcript saved?', 'In this version the server does not keep transcripts for you. The last 20 are kept in your own browser, on this device only, and you can delete them from the Dashboard at any time.'],
  ['How accurate is it?', 'It shows the video’s captions as they are. Captions written by the uploader are usually good; auto-generated ones can contain mistakes. Nothing is corrected or rewritten.'],
  ['Why does the SRT file trim times?', 'Many captions are timed so that one line is still on screen when the next begins, which makes players show two at once. By default the SRT ends each line when the next one starts. Your stored transcript keeps the original times, and you can switch trimming off.'],
  ['Can I use any transcript I get?', 'Not necessarily. The words in a video can be protected by copyright. Only use a transcript in ways you have the right to. This is general information, not legal advice.'],
];

export default function Faq() {
  return (
    <section className="section section--paper2" id="faq" aria-labelledby="faq-title">
      <div className="container faq">
        <h2 id="faq-title">Questions</h2>
        <div className="faq__list">
          {ITEMS.map(([q, a]) => (
            <details key={q} className="faq__item">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
