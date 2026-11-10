/**
 * Which programming ideas a piece of code uses (loops, dicts, recursion …).
 * Every run is tagged with these, so a student's progress map comes from
 * the code they really wrote and ran, not from quizzes. Plain pattern
 * matching on the code with strings and comments removed: fast, offline,
 * good enough for school-sized programs.
 */

export const CONCEPTS = [
  { id: 'output', en: 'Printing output', hi: 'आउटपुट दिखाना' },
  { id: 'input', en: 'Reading input', hi: 'इनपुट लेना' },
  { id: 'variables', en: 'Variables', hi: 'वेरिएबल' },
  { id: 'arithmetic', en: 'Arithmetic', hi: 'गणित की संक्रियाएँ' },
  { id: 'strings', en: 'Text (strings)', hi: 'टेक्स्ट (स्ट्रिंग)' },
  { id: 'conditions', en: 'Conditions (if/else)', hi: 'शर्तें (if/else)' },
  { id: 'for-loops', en: 'for loops', hi: 'for लूप' },
  { id: 'while-loops', en: 'while loops', hi: 'while लूप' },
  { id: 'lists', en: 'Lists', hi: 'लिस्ट' },
  { id: 'dicts', en: 'Dictionaries', hi: 'डिक्शनरी' },
  { id: 'tuples-sets', en: 'Tuples and sets', hi: 'टपल और सेट' },
  { id: 'comprehensions', en: 'Comprehensions', hi: 'कॉम्प्रिहेंशन' },
  { id: 'functions', en: 'Functions', hi: 'फ़ंक्शन' },
  { id: 'recursion', en: 'Recursion', hi: 'रिकर्शन' },
  { id: 'classes', en: 'Classes and objects', hi: 'क्लास और ऑब्जेक्ट' },
  { id: 'exceptions', en: 'Handling errors (try)', hi: 'त्रुटियाँ सँभालना (try)' },
  { id: 'files', en: 'Files', hi: 'फ़ाइलें' },
  { id: 'modules', en: 'Modules (import)', hi: 'मॉड्यूल (import)' },
  { id: 'data', en: 'Data (pandas / NumPy)', hi: 'डेटा (pandas / NumPy)' },
  { id: 'plots', en: 'Plots (matplotlib)', hi: 'ग्राफ़ (matplotlib)' },
];

export const conceptLabel = (id, lang = 'en') => {
  const c = CONCEPTS.find((x) => x.id === id);
  return c ? c[lang] || c.en : id;
};

/** Code without comments and string contents (so "for" in a message is not a loop). */
export function stripCode(code) {
  return String(code || '')
    .replace(/("""|''')[\s\S]*?\1/g, '""')
    .replace(/#.*$/gm, '')
    .replace(/([rbfuRBFU]{0,2})(['"])(?:\\.|(?!\2)[^\\\n])*\2/g, (m, prefix) => `${prefix}""`);
}

/** Function names defined in the code with their bodies (by indentation). */
function functionBodies(clean) {
  const lines = clean.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (!m) return;
    const indent = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      if (l.length - l.trimStart().length <= indent) break;
      body.push(l);
    }
    out.push({ name: m[2], body: body.join('\n') });
  });
  return out;
}

/** The concept ids a program uses, in CONCEPTS order. */
export function detectConcepts(code) {
  const raw = String(code || '');
  const c = stripCode(raw);
  const found = new Set();
  const has = (re) => re.test(c);
  if (has(/\bprint\s*\(/)) found.add('output');
  if (has(/\binput\s*\(/)) found.add('input');
  if (has(/^\s*[A-Za-z_]\w*(\s*,\s*[A-Za-z_]\w*)*\s*(=|\+=|-=|\*=|\/=)(?!=)/m)) found.add('variables');
  if (has(/[\w)\]]\s*(\*\*|\/\/|[-+*/%])\s*[\w(]/)) found.add('arithmetic');
  if (/(['"]).*\1/.test(raw) && (has(/\.(upper|lower|strip|split|join|replace|find|startswith|endswith|format|title|count)\s*\(/) || /\bf(['"])/.test(raw) || has(/\blen\s*\(/))) found.add('strings');
  if (has(/^\s*(if|elif)\b.*:/m)) found.add('conditions');
  if (has(/^\s*for\b.+\bin\b.+:/m)) found.add('for-loops');
  if (has(/^\s*while\b.+:/m)) found.add('while-loops');
  if (has(/\[[^\]]*\]/) && (has(/=\s*\[/) || has(/\.(append|pop|insert|remove|sort|extend)\s*\(/) || has(/\blist\s*\(/))) found.add('lists');
  if (has(/=\s*\{[^}]*:/) || has(/\bdict\s*\(/) || has(/\.(items|keys|values|get)\s*\(/)) found.add('dicts');
  if (has(/\b(tuple|set)\s*\(/) || has(/=\s*\([^)]*,[^)]*\)/) || has(/=\s*\{[^:}]+\}/)) found.add('tuples-sets');
  if (has(/[[{(][^\]})]*\bfor\b[^\]})]*\bin\b[^\]})]*[\]})]/)) found.add('comprehensions');
  const funcs = functionBodies(c);
  if (funcs.length || has(/\blambda\b/)) found.add('functions');
  if (funcs.some((f) => new RegExp(`\\b${f.name}\\s*\\(`).test(f.body))) found.add('recursion');
  if (has(/^\s*class\s+\w+/m)) found.add('classes');
  if (has(/^\s*try\s*:/m)) found.add('exceptions');
  if (has(/\bopen\s*\(/) || has(/\b(read_csv|to_csv|read_excel)\s*\(/)) found.add('files');
  if (has(/^\s*(import|from)\s+\w+/m)) found.add('modules');
  if (has(/^\s*(import|from)\s+(pandas|numpy)\b/m)) found.add('data');
  if (has(/^\s*(import|from)\s+(matplotlib|seaborn|plotly)\b/m)) found.add('plots');
  return CONCEPTS.map((x) => x.id).filter((id) => found.has(id));
}
