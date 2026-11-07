// Languages offered in the selector. "Auto" lets the video's own default caption language win.
// Whether a given video has captions in a language is only known after asking; the result shows what came back.
export const LANGUAGES = [
  ['', 'Auto (video default)'],
  ['en', 'English'], ['hi', 'Hindi / हिन्दी'], ['bn', 'Bengali / বাংলা'], ['ta', 'Tamil / தமிழ்'], ['te', 'Telugu / తెలుగు'],
  ['mr', 'Marathi / मराठी'], ['ur', 'Urdu / اردو'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'],
  ['it', 'Italian'], ['ru', 'Russian'], ['ar', 'Arabic'], ['tr', 'Turkish'], ['id', 'Indonesian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
];

export function languageName(code) {
  if (!code) return 'Auto';
  const hit = LANGUAGES.find(([c]) => c === code);
  return hit ? hit[1].split(' / ')[0] : code.toUpperCase();
}
