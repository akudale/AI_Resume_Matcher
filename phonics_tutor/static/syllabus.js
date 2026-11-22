/*
 * Phonics syllabus for 4-5 year olds: Beginner -> Intermediate -> Advanced.
 * Works in the browser (window.PhonicsSyllabus) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhonicsSyllabus = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // How the tutor *says* each sound (text-to-speech friendly spellings).
  const SOUNDS = {
    a: 'ah', b: 'buh', c: 'kuh', d: 'duh', e: 'eh', f: 'ffff', g: 'guh', h: 'huh',
    i: 'ih', j: 'juh', k: 'kuh', l: 'llll', m: 'mmmm', n: 'nnnn', o: 'aw', p: 'puh',
    q: 'kwuh', r: 'rrrr', s: 'ssss', t: 'tuh', u: 'uh', v: 'vvvv', w: 'wuh', x: 'ks',
    y: 'yuh', z: 'zzzz',
    sh: 'shhh', ch: 'chuh', th: 'thh', ck: 'kuh', ng: 'ng', wh: 'wuh', ph: 'ffff', qu: 'kwuh',
    ll: 'llll', ss: 'ssss', ff: 'ffff', zz: 'zzzz',
    ai: 'ay', ay: 'ay', ee: 'ee', ea: 'ee', oa: 'oh', ow: 'oh', oo: 'oo', ar: 'ar',
    or: 'or', er: 'er', ir: 'er', ur: 'er', ou: 'ow', oi: 'oy', oy: 'oy',
  };
  const LONG_VOWEL = { a: 'ay', e: 'ee', i: 'eye', o: 'oh', u: 'you' };
  const TWO_LETTER = Object.keys(SOUNDS).filter((k) => k.length === 2);

  const LEVELS = [
    { id: 1, band: 'Beginner', name: 'Letter Sounds', icon: '🔤',
      about: 'Every letter makes a sound. We learn the sound, a picture and an action.' },
    { id: 2, band: 'Beginner', name: 'Blending Words', icon: '🧩',
      about: 'Push sounds together to read little words like c-a-t, cat!' },
    { id: 3, band: 'Intermediate', name: 'Two Letters, One Sound', icon: '👯',
      about: 'Some letters team up to make one new sound, like sh and ch.' },
    { id: 4, band: 'Intermediate', name: 'Blends', icon: '🌀',
      about: 'Two sounds side by side that we say quickly, like fl in flag.' },
    { id: 5, band: 'Intermediate', name: 'Magic e', icon: '🪄',
      about: 'A magic e at the end makes the vowel say its name: cap becomes cape!' },
    { id: 6, band: 'Advanced', name: 'Vowel Teams', icon: '🤝',
      about: 'Vowel teams: when two vowels go walking, the first one does the talking.' },
    { id: 7, band: 'Advanced', name: 'Tricky Words', icon: '⭐',
      about: 'Words we cannot sound out easily, so we remember them by sight.' },
    { id: 8, band: 'Advanced', name: 'Reading Sentences', icon: '📖',
      about: 'Put it all together and read real sentences!' },
  ];

  // ---- Level 1: letter sounds (Jolly-Phonics-style teaching order) ----
  const LETTERS = [
    ['s', '🐍', 'Like a hissing snake. Wiggle your hand like a snake!', [['sun', '☀️'], ['sock', '🧦'], ['snake', '🐍'], ['six', '6️⃣']]],
    ['a', '🐜', 'Like ants crawling up your arm! Wiggle your fingers.', [['apple', '🍎'], ['ant', '🐜'], ['alligator', '🐊'], ['axe', '🪓']]],
    ['t', '🎾', 'Like watching tennis. Turn your head, t, t, t!', [['tiger', '🐯'], ['tent', '⛺'], ['ten', '🔟'], ['tooth', '🦷']]],
    ['p', '🕯️', 'Like blowing out a candle. Puff, puff!', [['pig', '🐷'], ['pan', '🍳'], ['pen', '🖊️'], ['penguin', '🐧']]],
    ['i', '🐭', 'Like a little mouse: ih, ih, ih! Wiggle your fingers like whiskers.', [['insect', '🐞'], ['igloo', '🧊'], ['ink', '🖋️'], ['in', '📥']]],
    ['n', '✈️', 'Like a plane: nnnn! Hold out your arms and fly.', [['nose', '👃'], ['net', '🥅'], ['nut', '🥜'], ['nest', '🪺']]],
    ['m', '😋', 'Like yummy food: mmmm! Rub your tummy.', [['moon', '🌙'], ['monkey', '🐒'], ['mouse', '🐭'], ['map', '🗺️']]],
    ['d', '🥁', 'Like a drum: d, d, d! Bang your drum.', [['dog', '🐶'], ['duck', '🦆'], ['drum', '🥁'], ['door', '🚪']]],
    ['g', '💧', 'Like water going down the drain: g, g, g!', [['goat', '🐐'], ['gift', '🎁'], ['girl', '👧'], ['grapes', '🍇']]],
    ['o', '💡', 'Like turning a light on and off: o, o, o!', [['octopus', '🐙'], ['ox', '🐂'], ['otter', '🦦'], ['on', '🔛']]],
    ['c', '🥢', 'Like clicking castanets: k, k, k!', [['cat', '🐱'], ['cup', '☕'], ['car', '🚗'], ['cake', '🎂']]],
    ['k', '🪁', 'K says the same sound as c: k, k, k!', [['kite', '🪁'], ['king', '🤴'], ['key', '🔑'], ['kangaroo', '🦘']]],
    ['e', '🥚', 'Like cracking an egg: eh, eh, eh!', [['egg', '🥚'], ['elephant', '🐘'], ['elf', '🧝'], ['envelope', '✉️']]],
    ['u', '☂️', 'Like putting up an umbrella: uh, uh, uh!', [['umbrella', '☂️'], ['up', '⬆️'], ['under', '⬇️'], ['uncle', '👨']]],
    ['r', '🐶', 'Like a puppy growling: rrrr!', [['rabbit', '🐰'], ['rain', '🌧️'], ['ring', '💍'], ['robot', '🤖']]],
    ['h', '🥵', 'Like being out of breath: h, h, h!', [['hat', '🎩'], ['horse', '🐴'], ['house', '🏠'], ['hen', '🐔']]],
    ['b', '⚽', 'Like bouncing a ball: b, b, b!', [['ball', '⚽'], ['bat', '🦇'], ['bus', '🚌'], ['banana', '🍌']]],
    ['f', '🐟', 'Like air going out of a fish: ffff!', [['fish', '🐟'], ['frog', '🐸'], ['fan', '🪭'], ['fox', '🦊']]],
    ['l', '🍭', 'Like licking a lolly: llll!', [['lion', '🦁'], ['leaf', '🍃'], ['lamp', '💡'], ['log', '🪵']]],
    ['j', '🍮', 'Like wobbly jelly: j, j, j!', [['jam', '🍯'], ['jet', '✈️'], ['jelly', '🍮'], ['juice', '🧃']]],
    ['v', '🚐', 'Like driving a van: vvvv!', [['van', '🚐'], ['violin', '🎻'], ['vase', '🏺'], ['volcano', '🌋']]],
    ['w', '🌬️', 'Like blowing wind: w, w, w!', [['web', '🕸️'], ['watch', '⌚'], ['water', '💧'], ['worm', '🪱']]],
    ['x', '📦', 'X says ks. It likes to sit at the end of words!', [['box', '📦'], ['fox', '🦊'], ['six', '6️⃣'], ['ox', '🐂']]],
    ['y', '🪀', 'Like saying yes to yummy yogurt: y, y, y!', [['yoyo', '🪀'], ['yak', '🐃'], ['yellow', '💛'], ['yarn', '🧶']]],
    ['z', '🐝', 'Like a buzzing bee: zzzz!', [['zebra', '🦓'], ['zip', '🤐'], ['zoo', '🦁'], ['zero', '0️⃣']]],
    ['q', '🦆', 'Q and u are best friends. Together they say kw, like a duck: quack!', [['queen', '👸'], ['quilt', '🛏️'], ['question', '❓'], ['quack', '🦆']]],
  ];

  const lessons = [];
  const add = (level, l) => lessons.push(Object.assign({ level }, l));

  LETTERS.forEach(([ch, emoji, tip, words]) => add(1, {
    id: `letter-${ch}`, type: 'letter', title: `Letter ${ch.toUpperCase()}`,
    keys: [ch], display: ch.toUpperCase() + ch, say: SOUNDS[ch], emoji, tip,
    position: ch === 'x' ? 'end' : 'start',
    words: words.map(([w, e]) => ({ w, e })),
  }));

  const W = (list) => list.map(([w, e]) => ({ w, e }));

  // ---- Level 2: CVC blending ----
  [
    ['a', [['cat', '🐱'], ['hat', '🎩'], ['bat', '🦇'], ['map', '🗺️'], ['van', '🚐'], ['bag', '👜']]],
    ['e', [['hen', '🐔'], ['pen', '🖊️'], ['bed', '🛏️'], ['net', '🥅'], ['ten', '🔟'], ['web', '🕸️']]],
    ['i', [['pig', '🐷'], ['pin', '📌'], ['six', '6️⃣'], ['zip', '🤐'], ['lip', '👄'], ['bin', '🗑️']]],
    ['o', [['dog', '🐶'], ['pot', '🍲'], ['box', '📦'], ['fox', '🦊'], ['mop', '🧹'], ['log', '🪵']]],
    ['u', [['sun', '☀️'], ['bus', '🚌'], ['cup', '☕'], ['bug', '🐛'], ['hut', '🛖'], ['mug', '🍺']]],
  ].forEach(([v, words]) => add(2, {
    id: `cvc-${v}`, type: 'cvc', title: `Short ${v} words`, keys: [v], display: `-${v}-`,
    say: SOUNDS[v], emoji: words[0][1],
    tip: `Listen for the ${SOUNDS[v]} sound in the middle. Push the sounds together to read the word!`,
    words: W(words),
  }));

  // ---- Level 3: digraphs ----
  [
    ['sh', '🤫', 'Put your finger on your lips: shhh!', [['ship', '🚢'], ['shell', '🐚'], ['fish', '🐟'], ['shoe', '👟']]],
    ['ch', '🚂', 'Like a choo-choo train: ch, ch, ch!', [['chick', '🐥'], ['chair', '🪑'], ['cheese', '🧀'], ['chin', '🫤']]],
    ['th', '👅', 'Poke your tongue out a little bit: thh!', [['thumb', '👍'], ['three', '3️⃣'], ['bath', '🛁'], ['moth', '🦋']]],
    ['ck', '🦆', 'c and k together say just one k sound, at the end of words.', [['duck', '🦆'], ['sock', '🧦'], ['clock', '🕰️'], ['rock', '🪨']]],
    ['ng', '🔔', 'Like a bell ringing: ng, ng!', [['ring', '💍'], ['king', '🤴'], ['wing', '🪽'], ['swing', '🛝']]],
    ['wh', '🐋', 'w and h together say w, like in whale.', [['whale', '🐋'], ['wheel', '🛞'], ['white', '⚪'], ['whisk', '🥄']]],
    ['ph', '📱', 'p and h together say ffff, like in phone!', [['phone', '📱'], ['photo', '📷'], ['dolphin', '🐬'], ['elephant', '🐘']]],
  ].forEach(([g, emoji, tip, words]) => add(3, {
    id: `digraph-${g}`, type: 'digraph', title: `${g} sound`, keys: [g], display: g,
    say: SOUNDS[g], emoji, tip, words: W(words),
  }));

  // ---- Level 4: consonant blends ----
  [
    ['bl, cl, fl', ['bl', 'cl', 'fl'], [['block', '🧱'], ['clap', '👏'], ['flag', '🚩'], ['flower', '🌸']]],
    ['st, sp, sn', ['st', 'sp', 'sn'], [['star', '⭐'], ['spoon', '🥄'], ['snail', '🐌'], ['stop', '🛑']]],
    ['tr, dr, fr', ['tr', 'dr', 'fr'], [['tree', '🌳'], ['drum', '🥁'], ['frog', '🐸'], ['truck', '🚚']]],
    ['gr, br, cr', ['gr', 'br', 'cr'], [['grapes', '🍇'], ['bread', '🍞'], ['crab', '🦀'], ['crown', '👑']]],
    ['nd, nk, mp', ['nd', 'nk', 'mp'], [['hand', '✋'], ['sink', '🚰'], ['lamp', '💡'], ['jump', '🦘']]],
  ].forEach(([title, keys, words]) => add(4, {
    id: `blend-${keys.join('')}`, type: 'blend', title: `Blends ${title}`, keys, display: keys.join(' '),
    say: keys.join(', '), emoji: words[0][1],
    tip: 'Say both sounds, quick quick, without a gap!', words: W(words),
  }));

  // ---- Level 5: magic e ----
  [
    ['a', [['cake', '🎂'], ['snake', '🐍'], ['game', '🎮'], ['gate', '🚧']]],
    ['i', [['kite', '🪁'], ['bike', '🚲'], ['five', '5️⃣'], ['slide', '🛝']]],
    ['o', [['bone', '🦴'], ['rope', '🪢'], ['nose', '👃'], ['home', '🏠']]],
    ['u', [['cube', '🧊'], ['flute', '🪈'], ['tube', '🧪'], ['mule', '🫏']]],
  ].forEach(([v, words]) => add(5, {
    id: `magic-${v}`, type: 'magic', title: `Magic e: ${v}_e`, keys: [`${v}_e`], vowel: v,
    display: `${v}_e`, say: LONG_VOWEL[v], emoji: '🪄',
    tip: `The magic e is quiet, but it makes ${v} say its name: ${LONG_VOWEL[v]}!`,
    words: W(words),
  }));

  // ---- Level 6: vowel teams & r-controlled vowels ----
  [
    ['ai / ay', ['ai', 'ay'], 'ay', {}, [['rain', '🌧️'], ['snail', '🐌'], ['tray', '🍱'], ['play', '🛝']]],
    ['ee / ea', ['ee', 'ea'], 'ee', {}, [['tree', '🌳'], ['bee', '🐝'], ['sea', '🌊'], ['leaf', '🍃']]],
    ['oa / ow', ['oa', 'ow'], 'oh', { ow: 'oh' }, [['boat', '⛵'], ['goat', '🐐'], ['snow', '❄️'], ['coat', '🧥']]],
    ['oo', ['oo'], 'oo', {}, [['moon', '🌙'], ['boot', '👢'], ['spoon', '🥄'], ['zoo', '🦁']]],
    ['ar', ['ar'], 'ar', {}, [['car', '🚗'], ['star', '⭐'], ['farm', '🚜'], ['shark', '🦈']]],
    ['or', ['or'], 'or', {}, [['corn', '🌽'], ['fork', '🍴'], ['horse', '🐴'], ['storm', '⛈️']]],
    ['er / ir / ur', ['er', 'ir', 'ur'], 'er', {}, [['bird', '🐦'], ['girl', '👧'], ['nurse', '🧑‍⚕️'], ['letter', '✉️']]],
    ['ou / ow', ['ou', 'ow'], 'ow', { ow: 'ow' }, [['house', '🏠'], ['mouse', '🐭'], ['cow', '🐄'], ['owl', '🦉']]],
    ['oi / oy', ['oi', 'oy'], 'oy', {}, [['coin', '🪙'], ['boy', '👦'], ['toy', '🧸'], ['soil', '🪴']]],
  ].forEach(([title, keys, say, override, words]) => add(6, {
    id: `team-${keys.join('')}`, type: 'team', title: `${title} sound`, keys, display: keys.join(' '),
    say, override, emoji: words[0][1],
    tip: `These letters work as a team to say ${say}!`, words: W(words),
  }));

  // ---- Level 7: tricky (sight) words ----
  [
    ['Tricky words 1', ['the', 'a', 'I', 'is', 'to']],
    ['Tricky words 2', ['and', 'you', 'my', 'we', 'he']],
    ['Tricky words 3', ['she', 'was', 'said', 'are', 'they']],
  ].forEach(([title, list], n) => add(7, {
    id: `sight-${n + 1}`, type: 'sight', title, keys: [], display: list.slice(0, 3).join(' '),
    say: '', emoji: '⭐', tip: 'We cannot always sound these out, so we look and remember!',
    words: list.map((w) => ({ w, e: '' })),
  }));

  // ---- Level 8: reading sentences ----
  [
    ['Little sentences', [['I see a cat.', '🐱'], ['A dog can run.', '🐶'], ['The sun is hot.', '☀️'], ['I am big.', '💪']]],
    ['Story time', [['The ship is red.', '🚢'], ['A duck can swim.', '🦆'], ['I can see a star.', '⭐'], ['The frog is on a log.', '🐸']]],
    ['Big reader', [['The goat is in the rain.', '🐐'], ['I like my red bike.', '🚲'], ['She said the cake is good.', '🎂'], ['We play in the park.', '🛝']]],
  ].forEach(([title, list], n) => add(8, {
    id: `sentence-${n + 1}`, type: 'sentence', title, keys: [], display: '📖',
    say: '', emoji: '📖', tip: 'Point to each word as you read it!',
    sentences: list.map(([s, e]) => ({ s, e })),
    words: [],
  }));

  lessons.forEach((l, i) => { l.num = i + 1; l.index = i; });

  /** Split a word into sound units (graphemes) with how to say each one. */
  function soundOut(word, lesson) {
    const w = word.toLowerCase();
    const keys = (lesson && lesson.keys) || [];
    const override = (lesson && lesson.override) || {};
    const magic = !!(lesson && lesson.type === 'magic' && /[aeiou][^aeiou]e$/.test(w));
    const vowelAt = magic ? w.length - 3 : -1;
    // Positions covered by the lesson's focus sound(s), used for highlighting.
    const focus = new Array(w.length).fill(false);
    if (magic) { focus[vowelAt] = true; focus[w.length - 1] = true; }
    keys.filter((k) => !k.includes('_')).forEach((k) => {
      let at = w.indexOf(k);
      while (at !== -1) { for (let j = 0; j < k.length; j++) focus[at + j] = true; at = w.indexOf(k, at + 1); }
    });
    const out = [];
    let i = 0;
    while (i < w.length) {
      if (magic && i === w.length - 1) { out.push({ g: 'e', say: '', silent: true, focus: true }); i++; continue; }
      if (i === vowelAt) { out.push({ g: w[i], say: LONG_VOWEL[w[i]], focus: true }); i++; continue; }
      const two = w.slice(i, i + 2);
      const crossesMagic = magic && (i + 1 === vowelAt || i + 1 === w.length - 1);
      if (two.length === 2 && TWO_LETTER.includes(two) && !crossesMagic) {
        out.push({ g: two, say: override[two] || SOUNDS[two], focus: focus[i] || focus[i + 1] });
        i += 2; continue;
      }
      out.push({ g: w[i], say: SOUNDS[w[i]] || w[i], focus: focus[i] });
      i++;
    }
    return out;
  }

  /** Does a word contain one of the lesson's sound keys? */
  function wordHasKey(word, key) {
    const w = word.toLowerCase();
    if (key.includes('_')) return new RegExp(`${key[0]}[^aeiou]e$`).test(w);
    return w.includes(key);
  }

  return { LEVELS, LESSONS: lessons, SOUNDS, LONG_VOWEL, soundOut, wordHasKey };
});
