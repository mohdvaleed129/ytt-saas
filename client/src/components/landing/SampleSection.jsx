import { useState } from 'react';
import TranscriptView from '../generator/TranscriptView.jsx';
import { sampleTranscript } from '../../data/sample-transcript.js';

export default function SampleSection() {
  const [lang, setLang] = useState('en');
  const transcript = sampleTranscript(lang);
  return (
    <section className="section section--board" id="sample" aria-labelledby="sample-title">
      <div className="container sample">
        <div className="sample__intro">
          <h2 id="sample-title">Every line, with its time</h2>
          <p>
            This is a made-up sample, so you can try search, copy and the downloads right now. The downloads are real
            files; the text is not from any real video.
          </p>
        </div>
        <TranscriptView key={transcript.id} transcript={transcript} onSwitchLang={setLang} />
      </div>
    </section>
  );
}
