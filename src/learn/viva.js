/**
 * Viva Mode: after a student submits, two or three questions about their
 * own code ("Why did you use a dictionary on line 14?"). Made by rules from
 * the code — no AI, works offline. Each rule looks for one idea; the most
 * telling ones win, at most one question per kind, in code order.
 */
import { stripCode } from './concepts.js';

const RULES = [
  {
    kind: 'recursion', weight: 10,
    find: (ctx) => ctx.funcs.filter((f) => f.recursive).map((f) => ({ line: f.line, name: f.name })),
    en: ({ name, line }) => `Your function ${name}() on line ${line} calls itself. When does it stop, and what would happen without that stop?`,
    hi: ({ name, line }) => `लाइन ${line} पर आपका फ़ंक्शन ${name}() ख़ुद को बुलाता है। यह कब रुकता है, और अगर वह रुकने की शर्त न हो तो क्या होगा?`,
  },
  {
    kind: 'dict', weight: 8,
    find: (ctx) => ctx.match(/^\s*(\w+)\s*=\s*\{[^}]*:/).map((m) => ({ line: m.line, name: m.groups[1] })),
    en: ({ name, line }) => `Why did you use a dictionary for ${name} on line ${line}? What would be harder with a list?`,
    hi: ({ name, line }) => `लाइन ${line} पर ${name} के लिए आपने डिक्शनरी क्यों चुनी? लिस्ट से क्या मुश्किल होता?`,
  },
  {
    kind: 'while', weight: 7,
    find: (ctx) => ctx.match(/^\s*while\s+(.+):/).map((m) => ({ line: m.line, cond: m.groups[1].trim() })),
    en: ({ line, cond }) => `What makes the while loop on line ${line} (while ${cond}) stop? What happens if that never becomes false?`,
    hi: ({ line, cond }) => `लाइन ${line} का while लूप (while ${cond}) किस वजह से रुकता है? अगर शर्त कभी गलत न हो तो क्या होगा?`,
  },
  {
    kind: 'accumulator', weight: 7,
    find: (ctx) => ctx.match(/^\s+(\w+)\s*(\+=|-=|\*=)/).filter((m) => ctx.inLoop(m.line)).map((m) => ({ line: m.line, name: m.groups[1] })),
    en: ({ name, line }) => `What is the value of ${name} after the loop finishes? Explain how line ${line} changes it each time round.`,
    hi: ({ name, line }) => `लूप ख़त्म होने के बाद ${name} का मान क्या होगा? समझाइए कि लाइन ${line} हर बार इसे कैसे बदलती है।`,
  },
  {
    kind: 'input-number', weight: 6,
    find: (ctx) => ctx.match(/(int|float)\s*\(\s*input\s*\(/).map((m) => ({ line: m.line, fn: m.groups[1] })),
    en: ({ line }) => `What happens on line ${line} if the user types a word instead of a number? How could your program handle that?`,
    hi: ({ line }) => `अगर उपयोगकर्ता संख्या की जगह कोई शब्द टाइप करे तो लाइन ${line} पर क्या होगा? आपका प्रोग्राम इसे कैसे सँभाल सकता है?`,
  },
  {
    kind: 'function', weight: 6,
    find: (ctx) => ctx.funcs.filter((f) => !f.recursive).map((f) => ({ line: f.line, name: f.name, params: f.params })),
    en: ({ name, line, params }) => `What does ${name}(${params}) on line ${line} give back? Give one example input and the result you expect.`,
    hi: ({ name, line, params }) => `लाइन ${line} का ${name}(${params}) क्या लौटाता है? एक उदाहरण इनपुट और उसका अपेक्षित परिणाम बताइए।`,
  },
  {
    kind: 'comprehension', weight: 5,
    find: (ctx) => ctx.match(/\[[^\]]*\bfor\b[^\]]*\bin\b[^\]]*\]/).map((m) => ({ line: m.line })),
    en: ({ line }) => `Describe in words what the list comprehension on line ${line} builds, as if it were a normal for loop.`,
    hi: ({ line }) => `लाइन ${line} की लिस्ट कॉम्प्रिहेंशन शब्दों में समझाइए, जैसे वह एक सामान्य for लूप हो।`,
  },
  {
    kind: 'try', weight: 5,
    find: (ctx) => ctx.match(/^\s*except\b\s*([\w.]*)/).map((m) => ({ line: m.line, err: m.groups[1] || 'any error' })),
    en: ({ line, err }) => `The except on line ${line} catches ${err}. When could that error happen in your program?`,
    hi: ({ line, err }) => `लाइन ${line} का except ${err} पकड़ता है। आपके प्रोग्राम में यह त्रुटि कब हो सकती है?`,
  },
  {
    kind: 'for-range', weight: 4,
    find: (ctx) => ctx.match(/^\s*for\s+(\w+)\s+in\s+range\((.+)\)\s*:/).map((m) => ({ line: m.line, v: m.groups[1], r: m.groups[2] })),
    en: ({ line, v, r }) => `In the loop on line ${line}, what are the first and last values of ${v} for range(${r})? How many times does it run?`,
    hi: ({ line, v, r }) => `लाइन ${line} के लूप में range(${r}) के लिए ${v} का पहला और आख़िरी मान क्या है? यह कितनी बार चलता है?`,
  },
  {
    kind: 'for', weight: 3,
    find: (ctx) => ctx.match(/^\s*for\s+(\w+(?:\s*,\s*\w+)*)\s+in\s+(?!range\()(.+):/).map((m) => ({ line: m.line, v: m.groups[1], it: m.groups[2].trim() })),
    en: ({ line, v, it }) => `On line ${line}, what is ${v} the first time round the loop over ${it}, and what does the loop do with it?`,
    hi: ({ line, v, it }) => `लाइन ${line} पर ${it} पर चलने वाले लूप में पहली बार ${v} क्या होता है, और लूप उसके साथ क्या करता है?`,
  },
  {
    kind: 'condition', weight: 3,
    find: (ctx) => ctx.match(/^\s*if\s+(.+):/).map((m) => ({ line: m.line, cond: m.groups[1].trim() })),
    en: ({ line, cond }) => `What happens when the condition on line ${line} (${cond}) is false? Give an input that makes it false.`,
    hi: ({ line, cond }) => `जब लाइन ${line} की शर्त (${cond}) गलत होती है तब क्या होता है? ऐसा इनपुट बताइए जिससे यह गलत हो।`,
  },
  {
    kind: 'class', weight: 4,
    find: (ctx) => ctx.match(/^\s*class\s+(\w+)/).map((m) => ({ line: m.line, name: m.groups[1] })),
    en: ({ name, line }) => `What does an object of your class ${name} (line ${line}) keep track of, and what is self inside its methods?`,
    hi: ({ name, line }) => `लाइन ${line} की आपकी क्लास ${name} का ऑब्जेक्ट क्या-क्या याद रखता है, और उसके मेथड में self क्या है?`,
  },
];

/** What the rules look at: lines (without strings and comments), functions, loops. */
function context(code) {
  const raw = String(code || '').split('\n');
  const clean = stripCode(code).split('\n');
  const indentOf = (l) => l.length - l.trimStart().length;
  const funcs = [];
  clean.forEach((l, i) => {
    const m = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)/.exec(l);
    if (!m) return;
    const ind = m[1].length;
    let recursive = false;
    for (let j = i + 1; j < clean.length; j++) {
      if (!clean[j].trim()) continue;
      if (indentOf(clean[j]) <= ind) break;
      if (new RegExp(`\\b${m[2]}\\s*\\(`).test(clean[j])) recursive = true;
    }
    funcs.push({ line: i + 1, name: m[2], params: m[3].trim(), recursive });
  });
  const loops = [];
  clean.forEach((l, i) => { if (/^\s*(for|while)\b.*:\s*$/.test(l)) loops.push({ line: i + 1, indent: indentOf(l) }); });
  return {
    raw,
    funcs,
    match(re) {
      const out = [];
      clean.forEach((l, i) => { const m = re.exec(l); if (m) out.push({ line: i + 1, groups: m.map((g) => (g === undefined ? '' : g)) }); });
      return out;
    },
    /** Is line n inside a loop body? */
    inLoop(n) {
      const ind = indentOf(clean[n - 1] || '');
      return loops.some((lp) => lp.line < n && lp.indent < ind && clean.slice(lp.line, n - 1).every((l) => !l.trim() || indentOf(l) > lp.indent));
    },
  };
}

/**
 * Questions about this code.
 * @returns {{ kind: string, line: number, lineText: string, en: string, hi: string }[]}
 */
export function vivaQuestions(code, { max = 3 } = {}) {
  const ctx = context(code);
  const found = [];
  for (const rule of RULES) {
    const hits = rule.find(ctx);
    if (!hits.length) continue;
    const h = hits[0];
    found.push({ kind: rule.kind, weight: rule.weight, line: h.line, lineText: (ctx.raw[h.line - 1] || '').trim(), en: rule.en(h), hi: rule.hi(h) });
  }
  // The most telling ideas, then shown in the order they appear in the code
  const picked = found.sort((a, b) => b.weight - a.weight).slice(0, max).sort((a, b) => a.line - b.line);
  if (!picked.length && String(code || '').trim()) {
    const lines = ctx.raw.map((l, i) => ({ l: l.trim(), i })).filter((x) => x.l && !x.l.startsWith('#'));
    const last = lines[lines.length - 1];
    if (last) {
      picked.push({
        kind: 'explain', weight: 1, line: last.i + 1, lineText: last.l,
        en: `Explain in your own words what your program does, step by step. What does line ${last.i + 1} print or produce?`,
        hi: `अपने शब्दों में समझाइए कि आपका प्रोग्राम क़दम-दर-क़दम क्या करता है। लाइन ${last.i + 1} क्या print या तैयार करती है?`,
      });
    }
  }
  return picked.map(({ weight, ...q }) => q);
}
