/*
 * The tutor's "brain": understands what the child (or grown-up) said.
 *  - parseIntent: navigation & control commands ("next", "go back", "lesson 5", "teach me sh"...)
 *  - matchAnswer / matchOption: forgiving checks of spoken answers (kids' speech is messy!)
 *  - localAnswer: questions we can answer without the AI server.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhonicsBrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ONES = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    to: 2, too: 2, for: 4, won: 1,
  };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  // What a speech recogniser may write when someone says a letter's *name*.
  const LETTER_NAMES = {
    a: 'a', ay: 'a', b: 'b', bee: 'b', be: 'b', c: 'c', see: 'c', sea: 'c', d: 'd', dee: 'd',
    e: 'e', ee: 'e', f: 'f', ef: 'f', eff: 'f', g: 'g', gee: 'g', h: 'h', aitch: 'h', haitch: 'h',
    i: 'i', eye: 'i', j: 'j', jay: 'j', k: 'k', kay: 'k', l: 'l', el: 'l', elle: 'l',
    m: 'm', em: 'm', n: 'n', en: 'n', o: 'o', oh: 'o', p: 'p', pee: 'p', pea: 'p',
    q: 'q', queue: 'q', cue: 'q', r: 'r', are: 'r', ar: 'r', s: 's', es: 's', ess: 's',
    t: 't', tea: 't', tee: 't', u: 'u', you: 'u', v: 'v', vee: 'v', w: 'w',
    x: 'x', ex: 'x', y: 'y', why: 'y', z: 'z', zed: 'z', zee: 'z',
  };

  const HOMOPHONES = {
    to: ['two', 'too'], two: ['to', 'too'], see: ['sea', 'c'], sea: ['see', 'c'], i: ['eye', 'aye', 'hi'],
    you: ['u', 'yu'], are: ['r', 'our'], be: ['bee', 'b'], bee: ['be', 'b'], one: ['won'], ant: ['aunt'],
    hen: ['hand'], in: ['inn'], he: ['hee'], we: ['wee'], my: ['mai'], the: ['da', 'duh', 'thee'],
    a: ['uh', 'ah', 'eh', 'hey'], is: ['his', 'iz'], was: ['wuz', 'what'], said: ['sed'], they: ['day', 'they re'],
    yoyo: ['yo', 'yoyos'], ox: ['ax', 'box'], axe: ['ax', 'acts'], tray: ['trey'], bin: ['been'],
    pin: ['pen'], pen: ['pin', 'pan'], hut: ['hot'], mug: ['mog'], cube: ['cue'],
  };

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[’'`]/g, '')
      .replace(/-/g, '')
      .replace(/[^a-z0-9_ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((t) => (/^\d+$/.test(t) && +t <= 10 ? DIGIT_WORDS[+t] : t))
      .join(' ');
  }
  const toks = (s) => normalize(s).split(' ').filter(Boolean);

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  /** Parse a number written as digits or words starting at tokens[i]. */
  function parseNum(t, i) {
    const w = t[i];
    if (w == null) return null;
    if (/^\d+$/.test(w)) return parseInt(w, 10);
    if (w === 'number') return parseNum(t, i + 1);
    if (TENS[w] != null) return TENS[w] + (ONES[t[i + 1]] != null && ONES[t[i + 1]] < 10 ? ONES[t[i + 1]] : 0);
    if (ONES[w] != null) return ONES[w];
    // normalize() turned small digits into words; "11" etc. stays digits.
    return null;
  }

  /** Turn "s h", "es aitch", "sh", "magic e a", "short a" into a lesson. */
  function findLesson(target, lessons) {
    const raw = toks(target);
    const joined = raw.join(' ');
    if (!joined) return null;
    const byType = (type) => lessons.find((l) => l.type === type);
    if (/\b(tricky|sight)\b/.test(joined)) return byType('sight');
    if (/\b(sentence|sentences|reading|story|stories)\b/.test(joined)) return byType('sentence');
    if (/\bblends?\b/.test(joined)) return byType('blend');
    if (/\bdigraphs?\b/.test(joined)) return byType('digraph');
    if (/\bvowel teams?\b/.test(joined)) return byType('team');
    if (/\b(blending|cvc)\b/.test(joined)) return byType('cvc');
    if (/\b(alphabet|abc)\b/.test(joined)) return lessons[0];

    const magic = joined.match(/\b(?:magic e|long)\s*([a-z]+)?/);
    if (magic) {
      const v = magic[1] && (LETTER_NAMES[magic[1]] || magic[1]);
      return lessons.find((l) => l.type === 'magic' && (!v || l.vowel === v)) || byType('magic');
    }
    const short = joined.match(/\bshort ([a-z]+)/);
    if (short) {
      const v = LETTER_NAMES[short[1]] || short[1];
      return lessons.find((l) => l.type === 'cvc' && l.keys[0] === v) || null;
    }
    let t = raw.filter((w) => !['the', 'a', 'an', 'sound', 'sounds', 'please', 'now', 'lesson',
      'letter', 'letters', 'one', 'some', 'about', 'with', 'me', 'words', 'word', 'again'].includes(w));
    if (!t.length && raw.includes('a')) t = ['a']; // "the letter a"
    if (!t.length) return null;
    // Collapse letter names: "s h" -> "sh", "see aitch" -> "ch"
    let key = null;
    if (t.length === 1 && t[0].length >= 2 && lessons.some((l) => l.keys.includes(t[0]))) key = t[0];
    else if (t.every((w) => LETTER_NAMES[w]) && t.length <= 3) key = t.map((w) => LETTER_NAMES[w]).join('');
    else if (t.length === 1 && /^[a-z]{1,3}$/.test(t[0])) key = t[0];
    if (key) {
      const exact = lessons.find((l) => l.type === 'letter' && l.keys[0] === key)
        || lessons.find((l) => l.keys.includes(key));
      if (exact) return exact;
    }
    // Lesson title, e.g. "tricky words 2"
    return lessons.find((l) => normalize(l.title) === joined || normalize(l.title) === t.join(' ')) || null;
  }

  const has = (n, re) => re.test(n);

  /**
   * Work out what the speaker wants.
   * Returns {type, value?} or null when it is not a command (it may be an answer).
   */
  function parseIntent(text, lessons) {
    const n = normalize(text);
    if (!n) return null;
    const t = n.split(' ');

    for (let i = 0; i < t.length; i++) {
      if (['lesson', 'lessons', 'level', 'levels', 'number'].includes(t[i])) {
        const num = parseNum(t, i + 1);
        if (num != null) return { type: t[i].startsWith('level') ? 'gotoLevel' : 'gotoLesson', value: num };
      }
    }
    if (has(n, /\b(stop talking|be quiet|pause|stop|wait)\b/) && t.length <= 3) return { type: 'stop' };
    if (has(n, /\b(start (again|over)|restart|from the start|do it again|play again|do this again)\b/)) return { type: 'restart' };
    if (has(n, /\b(first lesson|very beginning|from the beginning|start from scratch)\b/)) return { type: 'gotoLesson', value: 1 };
    if (has(n, /\b(last lesson|final lesson|hardest)\b/)) return { type: 'gotoLesson', value: lessons.length };
    if (has(n, /\b(menu|syllabus|all (the )?lessons|lesson list|list of lessons|show (me )?(the )?lessons|what lessons)\b/)) return { type: 'menu' };
    if (has(n, /\b(help|i dont know|dont know|i dunno|dunno|what do i do|hint|too hard|i cant)\b/)) return { type: 'help' };
    if (has(n, /\b(repeat|say (it|that) again|again|one more time|didnt hear|did not hear|listen again)\b/)
      || ['what', 'huh', 'pardon', 'sorry', 'what did you say'].includes(n)) return { type: 'repeat' };
    if (has(n, /\b(go back|back|previous|last one|before that|backwards?)\b/)) return { type: 'back' };
    if (has(n, /\b(next|forward|move on|go on|continue|keep going|go ahead|another lesson|new lesson)\b/)) return { type: 'next' };
    if (has(n, /\b(skip|pass)\b/)) return { type: 'skip' };

    const go = n.match(/^(?:can we |lets |let us |i want to |please |)(?:teach me|learn|go to|goto|do|show me|practice|practise|play|try)\b(?: about| the| a| an)*(?: letter| sound| letters)?\s*(.*)$/);
    if (go && go[1]) {
      const l = findLesson(go[1], lessons);
      if (l) return { type: 'gotoLesson', value: l.num };
    }
    if (has(n, /^(yes|yeah|yep|yup|ok|okay|sure|ready|alright|all right|lets go|yay|i am ready|im ready)\b/)) return { type: 'yes' };
    if (has(n, /^(no|nope|not yet|nah|no thanks|no thank you)\b/)) return { type: 'no' };
    if (has(n, /^(what|whats|how|hows|why|where|wheres|who|whos|when|which|can|could|does|do|did|is|are|will|would|should|tell me|explain|whats)\b/)
      || /\?\s*$/.test(String(text))) return { type: 'question' };
    return null;
  }

  function wordMatch(heard, target) {
    if (heard === target) return true;
    if (heard === `${target}s` || `${heard}s` === target || heard === `${target}es`) return true;
    if ((HOMOPHONES[target] || []).includes(heard)) return true;
    if (target.length >= 4 && lev(heard, target) <= 1) return true;
    if (target.length >= 7 && lev(heard, target) <= 2) return true;
    return false;
  }

  /**
   * Did the child say the target word/sentence? `alts` are recogniser alternatives.
   * exact=true only accepts precise matches (used before checking commands).
   */
  function matchAnswer(alts, target, exact) {
    const tt = toks(target);
    if (!tt.length) return false;
    const joinedTarget = tt.join('');
    return [].concat(alts || []).some((alt) => {
      const ht = toks(alt);
      if (!ht.length) return false;
      if (tt.length === 1) {
        if (exact) return ht.includes(tt[0]) || ht.join('') === joinedTarget;
        return ht.some((h) => wordMatch(h, tt[0])) || ht.join('') === joinedTarget
          || (HOMOPHONES[tt[0]] || []).includes(ht.join(' '));
      }
      const used = new Set();
      let hit = 0;
      tt.forEach((w) => {
        const k = ht.findIndex((h, idx) => !used.has(idx) && (exact ? h === w : wordMatch(h, w)));
        if (k !== -1) { used.add(k); hit++; }
      });
      return exact ? hit === tt.length : hit / tt.length >= 0.6;
    });
  }

  /** Which quiz option (index) did they pick, by word or by position ("the first one")? */
  function matchOption(alts, options) {
    for (let i = 0; i < options.length; i++) if (matchAnswer(alts, options[i], true)) return i;
    for (let i = 0; i < options.length; i++) if (matchAnswer(alts, options[i], false)) return i;
    const n = normalize([].concat(alts || [])[0] || '');
    if (/\b(third|three|last|right)\b/.test(n)) return Math.min(2, options.length - 1);
    if (/\b(second|two|middle)\b/.test(n)) return Math.min(1, options.length - 1);
    if (/\b(first|one|left)\b/.test(n)) return 0;
    return -1;
  }

  const FILLER = new Set(['the', 'a', 'an', 'i', 'its', 'it', 'is', 'um', 'uh', 'er', 'say', 'said', 'like', 'and', 'oh']);

  /**
   * How close was the child to the target word, and where did it differ?
   * Returns {kind: 'close', pos: 'start'|'middle'|'end', index, heard} | {kind: 'other', heard}
   *       | {kind: 'none'} | {kind: 'sentence'}.
   */
  function describeMistake(alts, target) {
    const tt = toks(target);
    if (tt.length !== 1) return { kind: 'sentence' };
    const t = tt[0];
    const all = [].concat(alts || []).map(toks);
    let best = null;
    all.forEach((ws) => ws.filter((w) => !FILLER.has(w) || w === t).forEach((w) => {
      const d = lev(w, t);
      if (!best || d < best.d) best = { w, d };
    }));
    if (!best) {
      const first = (all[0] || []).join(' ');
      return first ? { kind: 'other', heard: first } : { kind: 'none' };
    }
    const h = best.w;
    if (best.d === 0) return { kind: 'none' };
    if (best.d > Math.max(1, Math.floor(t.length / 2))) return { kind: 'other', heard: (all[0] || [h]).slice(0, 4).join(' ') };
    let index;
    if (h[0] !== t[0]) index = 0;
    else if (h.length === t.length) {
      index = [...t].findIndex((c, i) => c !== h[i]);
    } else if (h[h.length - 1] !== t[t.length - 1]) index = t.length - 1;
    else index = [...t].findIndex((c, i) => c !== h[i]);
    if (index < 0) index = t.length - 1;
    const pos = index === 0 ? 'start' : index === t.length - 1 ? 'end' : 'middle';
    return { kind: 'close', pos, index, heard: h };
  }

  /** Answer simple phonics questions without the AI server. Returns {text, tts} or null.
   *  `tok(say)` turns a sound into speech text (e.g. a recorded-sound token). */
  function localAnswer(text, lessons, tok = (x) => x) {
    const n = normalize(text);
    let m = n.match(/what (?:sound|noise) (?:does|do) (?:the )?(?:letters? )?(.+?) (?:make|say|says|makes)\b/)
      || n.match(/what (?:does|do) (?:the )?(?:letters? )?(.+?) (?:say|sound like)\b/)
      || n.match(/how do (?:you|i) say (?:the )?(?:letters? )?(.+?)(?: sound)?$/);
    if (m) {
      const l = findLesson(m[1], lessons);
      if (l && l.say && l.words.length) {
        const name = l.type === 'letter' ? l.keys[0].toUpperCase() : l.display;
        const ex = l.words[0].w;
        return { text: `${name} says /${l.say}/, like in ${ex} ${l.words[0].e}`, tts: `${name} says ${tok(l.say)}. ${tok(l.say)}. Like in ${ex}!` };
      }
    }
    m = n.match(/how (?:do (?:you|i)|to) spell (?:the word )?([a-z]+)/);
    if (m) {
      const w = m[1];
      const letters = w.split('');
      return { text: `${w} is spelled ${letters.join(' - ').toUpperCase()}`, tts: `${w} is spelled ${letters.map((c) => c.toUpperCase()).join(', ')}. ${w}!` };
    }
    m = n.match(/what (?:words? )?(?:start|starts|begin|begins) with (?:the )?(?:letters? )?(?:sound )?(.+)$/);
    if (m) {
      const l = findLesson(m[1], lessons);
      if (l && l.words.length) {
        const ws = l.words.map((x) => x.w);
        return { text: `${ws.join(', ')}! ${l.words.map((x) => x.e).join(' ')}`, tts: `Here are some: ${ws.join(', ')}!` };
      }
    }
    if (/\b(who are you|whats your name|what is your name)\b/.test(n)) {
      return { text: "I'm Pip the Phonics Parrot! 🦜 I love letters and sounds!", tts: "I'm Pip the Phonics Parrot! I love letters and sounds!" };
    }
    if (/\b(favou?rite food|like to eat|what do you eat|hungry)\b/.test(n)) return { text: 'Crackers! Crunchy crackers! Crackers starts with k, k, k! 🦜' };
    if (/\b(favou?rite colou?r)\b/.test(n)) return { text: 'Green, like my feathers! Green starts with g, g, g! 💚' };
    if (/\b(are you real|are you a robot|are you a computer)\b/.test(n)) return { text: "I'm a pretend parrot who lives in this screen. But I really love learning sounds with you! 🦜" };
    if (/\b(where do you live)\b/.test(n)) return { text: 'I live in a cosy nest inside this screen, with lots of letters! 🪺' };
    if (/\b(i love you|i like you|you are my friend|be my friend)\b/.test(n)) return { text: "Aww! I like you too! You're my favourite reading buddy! 💚" };
    if (/\b(can you fly)\b/.test(n)) return { text: 'Only in my imagination! Whoosh! Fly starts with f, f, f! 🦜' };
    if (/\bhow are you\b/.test(n)) return { text: "I'm super happy! Learning sounds with you is my favourite thing! 🦜" };
    if (/\bhow old are you\b/.test(n)) return { text: "I'm a parrot, so I'm 5 in parrot years! 🦜" };
    if (/\b(what can you do|what can i say|how does this work)\b/.test(n)) {
      return { text: 'I teach sounds! You can say: next, back, repeat, lesson 5, teach me sh, or ask me a question!' };
    }
    return null;
  }

  /** Pull a first name out of "my name is Maya" / "I'm Leo" / "Zara". */
  function parseName(text) {
    const n = normalize(text);
    const m = n.match(/(?:my names|my name is|name is|im|i am|its|call me|this is)\s+([a-z]+)/);
    let name = m ? m[1] : null;
    if (!name) {
      const t = n.split(' ').filter(Boolean);
      if (t.length >= 1 && t.length <= 2) name = t[0];
    }
    if (!name || ['hello', 'hi', 'hey', 'yes', 'no', 'ok', 'okay', 'um', 'uh', 'the', 'a'].includes(name)) return null;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  return { normalize, lev, parseIntent, findLesson, matchAnswer, matchOption, localAnswer, parseName, describeMistake, LETTER_NAMES };
});
