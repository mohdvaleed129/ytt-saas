// SYNTHETIC SAMPLE. Written for this site; it is not taken from any real video and never comes from the API.
// The cue times deliberately overlap, as caption timing often does, so the SRT overlap option has something to show.

const seg = (startMs, endMs, text) => ({ startMs, endMs, text });

const EN = [
  seg(0, 3600, 'Hello, this is a sample transcript.'),
  seg(2800, 6400, 'The text you see here is not from a real video.'),
  seg(6000, 9200, 'Every line carries the time it starts.'),
  seg(8800, 11800, 'You can search for any word.'),
  seg(11400, 14000, 'You can copy the whole text.'),
  seg(13800, 17400, 'Or download it as a TXT or an SRT subtitle file.'),
  seg(17400, 19000, '[Music]'),
  seg(19000, 23000, 'This only works when the video already has captions.'),
];

const HI = [
  seg(0, 3600, 'नमस्ते, यह एक नमूना ट्रांसक्रिप्ट है।'),
  seg(2800, 6400, 'यहाँ दिखाया गया पाठ किसी असली वीडियो से नहीं लिया गया है।'),
  seg(6000, 9200, 'हर पंक्ति के साथ उसका समय दिया गया है।'),
  seg(8800, 11800, 'आप किसी भी शब्द को खोज सकते हैं।'),
  seg(11400, 14000, 'आप पूरा पाठ कॉपी कर सकते हैं।'),
  seg(13800, 17400, 'या उसे TXT या SRT फ़ाइल के रूप में डाउनलोड कर सकते हैं।'),
  seg(17400, 19000, '[संगीत]'),
  seg(19000, 23000, 'यह तभी काम करता है जब वीडियो में पहले से कैप्शन हों।'),
];

const TRACKS = { en: EN, hi: HI };

/** @param {'en'|'hi'} lang */
export function sampleTranscript(lang = 'en') {
  const code = TRACKS[lang] ? lang : 'en';
  return {
    id: `sample-${code}`,
    source: 'sample',
    videoId: 'sample',
    lang: code,
    requestedLang: code,
    availableLangs: ['en', 'hi'],
    segments: TRACKS[code].map((s) => ({ ...s })),
  };
}
