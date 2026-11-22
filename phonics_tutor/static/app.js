/* Pip the Phonics Parrot — interactive voice phonics tutor for ages 4-5. */
(function () {
  'use strict';
  const { LEVELS, LESSONS, soundOut, wordHasKey } = window.PhonicsSyllabus;
  const Brain = window.PhonicsBrain;
  const $ = (s) => document.querySelector(s);
  const STORE_KEY = 'pip-phonics-v1';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------------------------------------------------------------- state
  const state = {
    idx: 0,
    progress: {}, // lessonId -> {stars, done}
    name: '',
    settings: { accent: 'en-US', rate: 0.85, autoListen: true, aiChat: true },
    ai: false,
    chat: [],
  };
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (typeof s.idx === 'number') state.idx = Math.max(0, Math.min(LESSONS.length - 1, s.idx));
      state.progress = s.progress || {};
      state.name = s.name || '';
      Object.assign(state.settings, s.settings || {});
    } catch (e) { /* private mode etc. */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        idx: state.idx, progress: state.progress, name: state.name, settings: state.settings,
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- speaking
  let speechToken = 0;
  let hurry = false; // child tapped the mic mid-speech: skip talking until we listen
  let voice = null;
  function pickVoice() {
    if (!window.speechSynthesis) return;
    const voices = speechSynthesis.getVoices();
    const acc = state.settings.accent;
    const same = voices.filter((v) => v.lang.replace('_', '-') === acc);
    const lang = voices.filter((v) => v.lang.startsWith('en'));
    const nice = (list) => list.find((v) => /female|samantha|zira|google|natural|aria|jenny|heera|veena|libby|sonia/i.test(v.name));
    voice = nice(same) || same[0] || nice(lang) || lang[0] || null;
  }
  if (window.speechSynthesis) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function speakPart(text, token) {
    return new Promise((resolve) => {
      if (token !== speechToken || hurry) return resolve();
      const fallbackMs = 1500 + text.length * 90;
      if (!window.speechSynthesis) return setTimeout(resolve, Math.min(fallbackMs, 400 + text.length * 30));
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = (voice && voice.lang) || state.settings.accent;
      u.rate = state.settings.rate;
      u.pitch = 1.15;
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(finish, fallbackMs); // some browsers never fire onend
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    });
  }

  /** Show `text` in Pip's bubble and speak it (or `tts` if given). */
  async function say(text, tts) {
    showBubble(text);
    if (hurry) return;
    const token = speechToken;
    const parts = String(tts || text)
      .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
      .split(/(?<=[.!?])\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    setTalking(true);
    for (const p of parts) {
      if (token !== speechToken || hurry) break;
      await speakPart(p, token);
    }
    if (token === speechToken) setTalking(false);
  }
  function cancelSpeech() {
    speechToken++;
    if (window.speechSynthesis) speechSynthesis.cancel();
    setTalking(false);
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, hurry ? 0 : ms));

  // ---------------------------------------------------------------- listening
  let rec = null;
  let listening = false;
  let micBlocked = false;
  function listenOnce() {
    return new Promise((resolve) => {
      if (!SR || micBlocked) return resolve({ unsupported: true });
      if (listening) stopListening();
      cancelSpeech();
      const r = new SR();
      rec = r;
      r.lang = state.settings.accent;
      r.interimResults = true;
      r.maxAlternatives = 5;
      r.continuous = false;
      let got = null;
      r.onresult = (e) => {
        const res = e.results[e.results.length - 1];
        showHeard(res[0].transcript, !res.isFinal);
        if (res.isFinal) got = { alts: Array.from(res).map((a) => a.transcript), text: res[0].transcript };
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          micBlocked = true;
          toast('Microphone is blocked. Allow it in the browser, or tap and type instead.');
        }
      };
      r.onend = () => {
        if (rec === r) { rec = null; setListening(false); }
        resolve(got || { timeout: true });
      };
      try { r.start(); setListening(true); } catch (e) { setListening(false); resolve({ timeout: true }); }
    });
  }
  function stopListening() {
    if (rec) { const r = rec; rec = null; try { r.abort(); } catch (e) { /* */ } }
    setListening(false);
  }

  // ---------------------------------------------------------------- input routing
  // Every input (voice, typing, tapping a card) goes through deliver().
  let waiter = null;
  let pendingInput = null;
  let run = 0; // lesson-flow token: bumping it aborts the running flow

  function deliver(input) {
    if (input.text) showHeard(input.text, false);
    if (waiter) { const w = waiter; waiter = null; w(input); return; }
    // Tutor was talking: remember the input and hurry to the next question.
    pendingInput = input;
    hurry = true;
    cancelSpeech();
  }

  function getInput(t) {
    if (pendingInput) { const p = pendingInput; pendingInput = null; hurry = false; return Promise.resolve(p); }
    hurry = false;
    return new Promise((resolve) => {
      waiter = resolve;
      if (state.settings.autoListen && !listening) autoListen(t, resolve);
    });
  }

  async function autoListen(t, myWaiter) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (t !== run || waiter !== myWaiter) return;
      const r = await listenOnce();
      if (r.alts) { if (waiter === myWaiter) deliver({ alts: r.alts, text: r.text, source: 'voice' }); return; }
      if (r.unsupported) return;
      if (attempt === 0 && t === run && waiter === myWaiter) await say("Your turn! I'm listening. 👂");
    }
    if (waiter === myWaiter) nudgeMic(true);
  }

  // ---------------------------------------------------------------- lesson engine
  const PRAISE = ['Great job! 🌟', 'Super! 🎉', 'Well done! 👏', 'You got it! 🥳', 'Amazing! ⭐', 'Brilliant! 🦜', 'Yes! Fantastic! 🎈'];
  const TRY_AGAIN = ["Good try! Let's try again.", 'Almost! Listen once more.', 'Nice try! One more time.'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const kid = () => (state.name ? `, ${state.name}` : '');

  let score = { first: 0, total: 0 };
  let currentAsk = null; // {model} for "help" / "I don't know"

  function lessonOf(i) { return LESSONS[Math.max(0, Math.min(LESSONS.length - 1, i))]; }

  function startLesson(i, opts = {}) {
    if (i < 0) { say("This is the very first lesson! Let's play it. 😊"); i = 0; }
    if (i >= LESSONS.length) { say('Wow, you finished every lesson! You are a phonics superstar! 🏆'); i = LESSONS.length - 1; }
    run++;
    cancelSpeech();
    stopListening();
    hurry = false;
    pendingInput = null;
    if (waiter) { const w = waiter; waiter = null; w(null); }
    state.idx = i;
    save();
    closeDrawer();
    lessonFlow(lessonOf(i), run, opts).catch((e) => console.error(e));
  }
  const goNext = () => startLesson(state.idx + 1);
  const goBack = () => startLesson(state.idx - 1);

  /**
   * Ask something and wait for the right answer.
   * check(input) -> bool. Returns 'first' | 'correct' | 'wrong' | 'skip' | null (aborted).
   */
  async function ask(t, { prompt, tts, check, exact, model, tries = 2 }) {
    let attempts = 0;
    let silent = false;
    currentAsk = { model };
    while (true) {
      if (!silent) await say(prompt, tts);
      silent = false;
      if (t !== run) return null;
      const inp = await getInput(t);
      if (t !== run || !inp) return null;
      let correct;
      if (inp.optionIndex != null) correct = check(inp);
      else if (exact && exact(inp)) correct = true;
      else {
        const intent = Brain.parseIntent(inp.text, LESSONS);
        if (intent && !['yes', 'no'].includes(intent.type)) {
          const r = await handleIntent(intent, inp, t);
          if (t !== run || r === 'abort') return null;
          if (r === 'skip') return 'skip';
          if (r === 'wait') { silent = true; continue; }
          continue; // repeat the question
        }
        correct = check(inp);
      }
      if (correct) return attempts === 0 ? 'first' : 'correct';
      attempts++;
      if (attempts >= tries) return 'wrong';
      await say(pick(TRY_AGAIN));
      if (t !== run) return null;
      if (model) { await model(); if (t !== run) return null; }
    }
  }

  async function handleIntent(intent, inp, t) {
    switch (intent.type) {
      case 'next': goNext(); return 'abort';
      case 'back': goBack(); return 'abort';
      case 'restart': startLesson(state.idx); return 'abort';
      case 'gotoLesson':
        if (intent.value >= 1 && intent.value <= LESSONS.length) { startLesson(intent.value - 1); return 'abort'; }
        await say(`We have lessons 1 to ${LESSONS.length}. Pick one of those!`);
        return 'repeat';
      case 'gotoLevel': {
        const first = LESSONS.find((l) => l.level === intent.value);
        if (first) { startLesson(first.index); return 'abort'; }
        await say(`We have levels 1 to ${LEVELS.length}. Pick one of those!`);
        return 'repeat';
      }
      case 'menu':
        openDrawer();
        await say('Here are all the lessons! Tap one, or say "lesson" and a number.');
        return 'wait';
      case 'stop':
        cancelSpeech();
        showBubble('Okay, I\'ll wait. Tap the 🎤 when you are ready!');
        return 'wait';
      case 'repeat': return 'repeat';
      case 'skip': await say("Okay, let's skip that one."); return 'skip';
      case 'help':
        if (currentAsk && currentAsk.model) { await say("That's okay! I'll help you."); await currentAsk.model(); return 'wait'; }
        await say('You can say: next, back, repeat, lesson 5, or teach me sh. You can ask me questions too!');
        return 'repeat';
      case 'question': {
        const nav = await answerQuestion(inp.text, t);
        return nav ? 'abort' : 'repeat';
      }
      default: return 'repeat';
    }
  }

  /** Answer a free question: local knowledge first, then the AI server. Returns true if it navigated. */
  async function answerQuestion(text, t) {
    const local = Brain.localAnswer(text, LESSONS);
    if (local) { await say(local.text, local.tts); return false; }
    if (!(state.ai && state.settings.aiChat)) {
      await say("Ooh, what a great question! Let's ask a grown-up about that one. Now, back to our sounds! 🦜");
      return false;
    }
    setThinking(true);
    try {
      const lesson = lessonOf(state.idx);
      const resp = await fetch('api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          child_name: state.name || null,
          lesson: { num: lesson.num, title: lesson.title, sound: lesson.say, words: lesson.words.map((w) => w.w) },
          lessons: LESSONS.map((l) => `${l.num}: ${l.title} (level ${l.level})`),
          history: state.chat.slice(-8),
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setThinking(false);
      if (t !== run) return true;
      state.chat.push({ role: 'user', content: text }, { role: 'assistant', content: data.reply || '' });
      if (data.reply) await say(data.reply);
      if (data.goto && data.goto >= 1 && data.goto <= LESSONS.length && t === run) {
        startLesson(data.goto - 1);
        return true;
      }
      return false;
    } catch (e) {
      setThinking(false);
      await say("Hmm, my thinking cap fell off! Let's keep learning sounds. 🦜");
      return false;
    }
  }

  async function sayWordSounds(word, lesson) {
    const parts = soundOut(word, lesson);
    renderWord(word, lesson, parts);
    if (word.length > 6 || lesson.type === 'letter') { await say(word, word); return; }
    const spoken = parts.filter((p) => !p.silent).map((p) => p.say).join('... ');
    await say(`${parts.map((p) => p.g).join(' - ')} ... ${word}!`, `${spoken}... ${word}!`);
  }

  function quizFor(lesson) {
    const correct = pick(lesson.words);
    const pool = LESSONS.filter((l) => l !== lesson && l.type !== 'sentence' && (lesson.type === 'sight' ? l.type === 'sight' : l.type !== 'sight'))
      .flatMap((l) => l.words);
    let prompt, tts, showEmoji = true;
    let ok;
    if (lesson.type === 'letter') {
      const ch = lesson.keys[0];
      const end = lesson.position === 'end';
      ok = (w) => (end ? w.endsWith(ch) : w.startsWith(ch));
      prompt = `Which one ${end ? 'ends' : 'starts'} with ${ch.toUpperCase()}?`;
      tts = `Which one ${end ? 'ends' : 'starts'} with ${lesson.say}?`;
    } else if (lesson.type === 'cvc' || lesson.type === 'sight') {
      ok = (w) => w === correct.w;
      prompt = `Find the word: "${correct.w}"`;
      tts = `Can you find the word ${correct.w}?`;
      showEmoji = false;
    } else {
      const key = lesson.keys.find((k) => wordHasKey(correct.w, k)) || lesson.keys[0];
      ok = (w) => wordHasKey(w, key);
      const label = key.replace('_', '…');
      prompt = `Which word has "${label}"?`;
      tts = key.includes('_') ? `Which word has a magic e, and ${key[0]} saying ${lesson.say}?` : `Which word has the ${lesson.override && lesson.override[key] || window.PhonicsSyllabus.SOUNDS[key] || key} sound?`;
    }
    const seen = new Set([correct.w]);
    const distractors = shuffle(pool).filter((x) => {
      if (seen.has(x.w) || ok(x.w)) return false;
      if (!['letter', 'cvc', 'sight'].includes(lesson.type) && lesson.keys.some((k) => wordHasKey(x.w, k))) return false;
      if (lesson.type === 'cvc' && x.w.length !== 3) return false;
      seen.add(x.w);
      return true;
    }).slice(0, 2);
    const options = shuffle([correct, ...distractors]);
    return { prompt, tts, options, answer: options.indexOf(correct), showEmoji };
  }

  async function lessonFlow(lesson, t, opts) {
    const alive = () => t === run;
    score = { first: 0, total: 0 };
    renderLesson(lesson);
    const lvl = LEVELS[lesson.level - 1];
    const isNewLevel = lesson.index === 0 || LESSONS[lesson.index - 1].level !== lesson.level;

    if (opts.greeting) { await say(opts.greeting); if (!alive()) return; }
    if (isNewLevel) { await say(`Level ${lvl.id}: ${lvl.name}! ${lvl.about}`); if (!alive()) return; }

    // ---- 1. Learn
    setStep('learn');
    if (lesson.type === 'letter') {
      const L = lesson.keys[0].toUpperCase();
      await say(`Lesson ${lesson.num}. This is the letter ${L}. ${L} says /${lesson.say}/!`, `Lesson ${lesson.num}. This is the letter ${L}. ${L} says ${lesson.say}. ${lesson.say}!`);
      if (!alive()) return;
      await say(lesson.tip); if (!alive()) return;
      const ex = lesson.words.slice(0, 3).map((w) => w.w);
      await say(`Listen: ${ex.join(', ')}.`, `Listen. ${lesson.say}, ${ex[0]}. ${lesson.say}, ${ex[1]}. ${lesson.say}, ${ex[2]}.`);
    } else if (lesson.type === 'sight') {
      await say(`Lesson ${lesson.num}: ${lesson.title}. ${lesson.tip}`);
    } else if (lesson.type === 'sentence') {
      await say(`Lesson ${lesson.num}: ${lesson.title}! Let's read some sentences. ${lesson.tip}`);
    } else {
      await say(`Lesson ${lesson.num}: ${lesson.title}. ${lesson.tip}`);
    }
    if (!alive()) return;

    // ---- 2. Practice
    setStep('practice');
    if (lesson.type === 'sentence') {
      for (let k = 0; k < lesson.sentences.length; k++) {
        const s = lesson.sentences[k];
        renderSentence(s);
        setDots(k, lesson.sentences.length);
        const model = async () => { await readSentenceSlowly(s.s, t); };
        const r = await ask(t, {
          prompt: k === 0 ? `Can you read this sentence${kid()}?` : pick(['Now read this one!', 'Your turn to read!', 'Can you read this?']),
          check: (inp) => Brain.matchAnswer(inp.alts, s.s, false),
          model, tries: 3,
        });
        if (r === null) return;
        await afterAnswer(r, s.s, t, model);
        if (!alive()) return;
      }
    } else {
      const items = lesson.type === 'sight' ? lesson.words : lesson.words.slice(0, 4);
      for (let k = 0; k < items.length; k++) {
        const wd = items[k];
        setDots(k, items.length);
        const model = async () => {
          if (lesson.type === 'sight') { renderWord(wd.w, lesson); await say(`This word is "${wd.w}".`, `This word is ${wd.w}. ${wd.w}.`); } else await sayWordSounds(wd.w, lesson);
        };
        let prompt;
        if (lesson.type === 'letter') {
          renderWord(wd.w, lesson, soundOut(wd.w, lesson));
          prompt = `Can you say "${wd.w}"? ${wd.e}`;
        } else if (lesson.type === 'sight') {
          renderWord(wd.w, lesson);
          await say(`This tricky word is "${wd.w}".`, `This tricky word is ${wd.w}.`);
          if (!alive()) return;
          prompt = `Can you say "${wd.w}"?`;
        } else {
          await model();
          if (!alive()) return;
          prompt = k === 0 ? `Now you read it${kid()}!` : pick(['Your turn!', 'Now you say it!', 'Can you read it?']);
        }
        const r = await ask(t, {
          prompt,
          exact: (inp) => Brain.matchAnswer(inp.alts, wd.w, true),
          check: (inp) => Brain.matchAnswer(inp.alts, wd.w, false),
          model,
        });
        if (r === null) return;
        await afterAnswer(r, wd.w, t, model);
        if (!alive()) return;
      }
    }

    // ---- 3. Quiz
    if (lesson.type !== 'sentence') {
      setStep('quiz');
      await say(pick(["Quiz time! Let's play a game. 🎮", 'Game time! 🎲']));
      if (!alive()) return;
      for (let q = 0; q < 2; q++) {
        const quiz = quizFor(lesson);
        setDots(q, 2);
        renderOptions(quiz);
        const names = quiz.options.map((o) => o.w);
        const r = await ask(t, {
          prompt: quiz.prompt,
          tts: `${quiz.tts} ${quiz.showEmoji ? names.join(', or ') + '?' : ''}`,
          check: (inp) => (inp.optionIndex != null ? inp.optionIndex : Brain.matchOption(inp.alts, names)) === quiz.answer,
          exact: (inp) => names.findIndex((w) => Brain.matchAnswer(inp.alts, w, true)) === quiz.answer,
          model: async () => { flashOption(quiz.answer); await say(`Look, it's ${names[quiz.answer]}!`); },
        });
        if (r === null) return;
        flashOption(quiz.answer);
        await afterAnswer(r, names[quiz.answer], t);
        clearOptions();
        if (!alive()) return;
      }
    }

    // ---- 4. Celebrate & choose what's next
    setStep('done');
    const stars = score.total === 0 ? 3 : Math.max(1, Math.round((score.first / score.total) * 3));
    const prev = state.progress[lesson.id] || {};
    state.progress[lesson.id] = { done: true, stars: Math.max(prev.stars || 0, stars) };
    save();
    renderDrawer();
    renderStars();
    celebrate(stars);
    await say(`You finished lesson ${lesson.num}${kid()}! You got ${stars} star${stars > 1 ? 's' : ''}! ${'⭐'.repeat(stars)}`);
    if (!alive()) return;
    await doneLoop(t);
  }

  async function afterAnswer(r, answer, t, model) {
    score.total++;
    if (r === 'first') score.first++;
    if (r === 'first' || r === 'correct') { sparkle(); await say(pick(PRAISE)); }
    else if (r === 'wrong') {
      await say(`That's okay! It says "${answer}". You are learning! 💪`, `That's okay! It says ${answer}. You are learning!`);
    }
    if (t === run) await pause(300);
  }

  async function readSentenceSlowly(sentence, t) {
    const words = sentence.replace(/[.!?]/g, '').split(' ');
    for (let i = 0; i < words.length; i++) {
      if (t !== run) return;
      highlightSentenceWord(i);
      await say(sentence, words[i]);
    }
    highlightSentenceWord(-1);
    if (t === run) await say(sentence);
  }

  async function doneLoop(t) {
    const last = state.idx === LESSONS.length - 1;
    let prompt = last ? 'You finished the whole course! Say "again" to play it again, or pick any lesson.'
      : 'Shall we go to the next lesson? Say "next", "again", or "back".';
    let silent = false;
    while (t === run) {
      if (!silent) await say(prompt);
      silent = false;
      if (t !== run) return;
      const inp = await getInput(t);
      if (!inp || t !== run) return;
      const intent = Brain.parseIntent(inp.text, LESSONS) || { type: 'chat' };
      if (intent.type === 'yes') { goNext(); return; }
      if (intent.type === 'repeat') { startLesson(state.idx); return; }
      if (intent.type === 'no') { await say('Okay! Pick any lesson you like, or ask me a question. 😊'); silent = true; continue; }
      if (intent.type === 'chat') {
        const nav = await answerQuestion(inp.text, t);
        if (nav) return;
        prompt = 'What shall we do now? Say "next" for a new lesson!';
        continue;
      }
      const r = await handleIntent(intent, inp, t);
      if (r === 'abort') return;
      if (r === 'wait') silent = true;
    }
  }

  // ---------------------------------------------------------------- welcome
  async function welcome() {
    const t = ++run;
    const lesson = lessonOf(state.idx);
    if (!state.name) {
      await say("Hi there! I'm Pip, the phonics parrot! 🦜 What's your name?");
      if (t !== run) return;
      const inp = await getInput(t);
      if (t !== run) return;
      const name = inp && (inp.optionIndex == null) ? Brain.parseName(inp.text) : null;
      if (name) { state.name = name; save(); $('#set-name').value = name; }
      await say(name ? `Nice to meet you, ${name}! 🎉` : 'Nice to meet you, friend! 🎉');
      if (t !== run) return;
      await say('You can talk to me! Say "next" to go on, "back" to go back, "repeat" to hear it again, or "lesson" and a number to jump. You can ask me questions too!');
      if (t !== run) return;
      startLesson(state.idx);
    } else {
      const doneCount = Object.values(state.progress).filter((p) => p.done).length;
      startLesson(state.idx, {
        greeting: doneCount
          ? `Welcome back, ${state.name}! 🦜 Let's do lesson ${lesson.num}: ${lesson.title}.`
          : `Hi ${state.name}! 🦜 Let's start learning sounds!`,
      });
    }
  }

  // ---------------------------------------------------------------- UI
  function showBubble(text) { $('#bubble-text').textContent = text; }
  function showHeard(text, interim) {
    const el = $('#heard');
    el.hidden = !text;
    el.classList.toggle('interim', !!interim);
    $('#heard-text').textContent = text;
  }
  function setTalking(on) { $('#pip').classList.toggle('talking', on); }
  function setThinking(on) { $('#pip').classList.toggle('thinking', on); if (on) showBubble('Hmm, let me think… 🤔'); }
  function setListening(on) {
    listening = on;
    $('#mic').classList.toggle('listening', on);
    $('#mic-label').textContent = on ? 'Listening…' : 'Tap & Talk';
    $('#pip').classList.toggle('listening', on);
    if (on) nudgeMic(false);
  }
  function nudgeMic(on) { $('#mic').classList.toggle('nudge', on); }
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }

  function renderLesson(lesson) {
    const lvl = LEVELS[lesson.level - 1];
    $('#lesson-num').textContent = `Lesson ${lesson.num} of ${LESSONS.length}`;
    $('#lesson-title').textContent = lesson.title;
    $('#level-chip').textContent = `${lvl.icon} Level ${lvl.id} · ${lvl.band}`;
    $('#level-chip').dataset.band = lvl.band;
    $('#focus').innerHTML = '';
    const big = document.createElement('div');
    big.className = 'focus-big';
    big.textContent = lesson.type === 'letter' ? `${lesson.keys[0].toUpperCase()} ${lesson.keys[0]}`
      : lesson.type === 'sentence' ? '📖' : lesson.display.replace(/_/g, '…');
    $('#focus').appendChild(big);
    if (lesson.type === 'letter') {
      const em = document.createElement('div');
      em.className = 'focus-emoji';
      em.textContent = lesson.emoji;
      $('#focus').appendChild(em);
    }
    big.onclick = () => deliverTapSound(lesson);
    const cards = $('#cards');
    cards.innerHTML = '';
    (lesson.type === 'sentence' ? [] : lesson.words).forEach((wd) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = `<span class="card-emoji">${wd.e || '⭐'}</span><span class="card-word"></span>`;
      b.querySelector('.card-word').textContent = wd.w;
      b.onclick = () => {
        if (waiter || listening) { deliver({ alts: [wd.w], text: wd.w, source: 'tap' }); return; }
        cancelSpeech(); sayWordSounds(wd.w, lesson);
      };
      cards.appendChild(b);
    });
    clearOptions();
    $('#sentence').hidden = true;
    $('#word').hidden = true;
    highlightDrawer();
    $('#bar-fill').style.width = `${(lesson.index / (LESSONS.length - 1)) * 100}%`;
    $('#back').disabled = lesson.index === 0;
  }
  function deliverTapSound(lesson) {
    if (!lesson.say) return;
    cancelSpeech();
    const name = lesson.type === 'letter' ? lesson.keys[0].toUpperCase() : lesson.display.replace(/_/g, ' ');
    say(`${name} says /${lesson.say}/`, `${lesson.say}. ${lesson.say}.`);
  }

  function renderWord(word, lesson, parts) {
    const el = $('#word');
    el.hidden = false;
    el.innerHTML = '';
    (parts || [{ g: word, focus: false }]).forEach((p) => {
      const s = document.createElement('span');
      s.className = `seg${p.focus ? ' focus' : ''}${p.silent ? ' silent' : ''}`;
      s.textContent = p.g;
      el.appendChild(s);
    });
    const wd = lesson.words.find((w) => w.w === word);
    if (wd && wd.e) {
      const e = document.createElement('span');
      e.className = 'word-emoji';
      e.textContent = wd.e;
      el.appendChild(e);
    }
    $('#cards').querySelectorAll('.card').forEach((c) => c.classList.toggle('active', c.querySelector('.card-word').textContent === word));
  }

  function renderSentence(s) {
    $('#word').hidden = true;
    const el = $('#sentence');
    el.hidden = false;
    el.innerHTML = '';
    s.s.split(' ').forEach((w) => {
      const span = document.createElement('span');
      span.className = 'sw';
      span.textContent = w;
      el.appendChild(span);
      el.appendChild(document.createTextNode(' '));
    });
    const e = document.createElement('span');
    e.className = 'word-emoji';
    e.textContent = s.e;
    el.appendChild(e);
  }
  function highlightSentenceWord(i) {
    $('#sentence').querySelectorAll('.sw').forEach((w, k) => w.classList.toggle('on', k === i));
  }

  function renderOptions(quiz) {
    $('#word').hidden = true;
    const el = $('#options');
    el.innerHTML = '';
    el.hidden = false;
    quiz.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'option';
      b.innerHTML = `${quiz.showEmoji ? `<span class="opt-emoji">${o.e || '⭐'}</span>` : ''}<span class="opt-word"></span>`;
      b.querySelector('.opt-word').textContent = o.w;
      b.onclick = () => {
        if (!waiter) return;
        b.classList.add(i === quiz.answer ? 'right' : 'wrong');
        stopListening();
        deliver({ optionIndex: i, alts: [o.w], text: o.w, source: 'tap' });
      };
      el.appendChild(b);
    });
  }
  function flashOption(i) { const b = $('#options').children[i]; if (b) b.classList.add('right'); }
  function clearOptions() { $('#options').hidden = true; $('#options').innerHTML = ''; }

  function setStep(step) {
    document.querySelectorAll('.step').forEach((s) => s.classList.toggle('on', s.dataset.step === step));
    if (step === 'done' || step === 'learn') setDots(-1, 0);
  }
  function setDots(k, n) {
    const el = $('#dots');
    el.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = `dot${i < k ? ' past' : ''}${i === k ? ' now' : ''}`;
      el.appendChild(d);
    }
  }
  function renderStars() {
    const total = Object.values(state.progress).reduce((a, p) => a + (p.stars || 0), 0);
    $('#star-count').textContent = total;
  }
  function sparkle() {
    const el = $('#pip');
    el.classList.remove('happy');
    void el.offsetWidth;
    el.classList.add('happy');
  }
  function celebrate(stars) {
    const layer = $('#confetti');
    layer.innerHTML = '';
    const bits = ['⭐', '🎉', '🌟', '🎈', '✨', '🦜'];
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('span');
      s.textContent = bits[i % bits.length];
      s.style.left = `${Math.random() * 100}%`;
      s.style.animationDelay = `${Math.random() * 0.8}s`;
      s.style.fontSize = `${18 + Math.random() * 22}px`;
      layer.appendChild(s);
    }
    setTimeout(() => { layer.innerHTML = ''; }, 3500);
    $('#focus').innerHTML = `<div class="focus-big stars">${'⭐'.repeat(stars)}</div>`;
    $('#word').hidden = true;
  }

  // ---- syllabus drawer
  function renderDrawer() {
    const el = $('#syllabus');
    el.innerHTML = '';
    let band = '';
    LEVELS.forEach((lvl) => {
      if (lvl.band !== band) {
        band = lvl.band;
        const h = document.createElement('h3');
        h.className = 'band';
        h.dataset.band = band;
        h.textContent = band;
        el.appendChild(h);
      }
      const sec = document.createElement('section');
      sec.className = 'level';
      const lessons = LESSONS.filter((l) => l.level === lvl.id);
      const done = lessons.filter((l) => (state.progress[l.id] || {}).done).length;
      sec.innerHTML = `<div class="level-head"><span>${lvl.icon} Level ${lvl.id}: ${lvl.name}</span><span class="level-done">${done}/${lessons.length}</span></div><p class="level-about"></p><div class="chips"></div>`;
      sec.querySelector('.level-about').textContent = lvl.about;
      lessons.forEach((l) => {
        const p = state.progress[l.id] || {};
        const b = document.createElement('button');
        b.className = `chip${p.done ? ' done' : ''}`;
        b.dataset.idx = l.index;
        b.title = l.title;
        b.innerHTML = `<span class="chip-num">${l.num}</span><span class="chip-label"></span><span class="chip-stars">${p.stars ? '⭐'.repeat(p.stars) : ''}</span>`;
        b.querySelector('.chip-label').textContent = l.type === 'letter' ? l.keys[0].toUpperCase() + l.keys[0] : l.title.replace(/ sound$/, '');
        b.onclick = () => startLesson(l.index);
        sec.querySelector('.chips').appendChild(b);
      });
      el.appendChild(sec);
    });
    highlightDrawer();
  }
  function highlightDrawer() {
    document.querySelectorAll('#syllabus .chip').forEach((c) => c.classList.toggle('current', +c.dataset.idx === state.idx));
  }
  function openDrawer() { $('#drawer').hidden = false; const c = document.querySelector('#syllabus .chip.current'); if (c) c.scrollIntoView({ block: 'center' }); }
  function closeDrawer() { $('#drawer').hidden = true; }

  // ---------------------------------------------------------------- wiring
  function wire() {
    $('#start').onclick = () => {
      $('#welcome').hidden = true;
      if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance('')); // unlock audio on iOS
      welcome();
    };
    $('#mic').onclick = () => {
      nudgeMic(false);
      if (listening) { stopListening(); return; }
      if (!SR) { $('#typed').focus(); toast('Voice listening needs Chrome, Edge or Safari. You can type instead!'); return; }
      if (!waiter) { hurry = true; cancelSpeech(); }
      listenOnce().then((r) => { if (r.alts) deliver({ alts: r.alts, text: r.text, source: 'voice' }); });
    };
    $('#next').onclick = () => goNext();
    $('#back').onclick = () => goBack();
    $('#repeat').onclick = () => {
      if (waiter) deliver({ alts: ['repeat'], text: 'repeat', source: 'button' });
      else startLesson(state.idx);
    };
    $('#lessons-btn').onclick = () => ($('#drawer').hidden ? openDrawer() : closeDrawer());
    $('#drawer-close').onclick = closeDrawer;
    $('#drawer').onclick = (e) => { if (e.target.id === 'drawer') closeDrawer(); };
    $('#type-form').onsubmit = (e) => {
      e.preventDefault();
      const v = $('#typed').value.trim();
      if (!v) return;
      $('#typed').value = '';
      stopListening();
      deliver({ alts: [v], text: v, source: 'typed' });
    };
    // settings
    $('#settings-btn').onclick = () => { $('#settings').hidden = false; };
    $('#settings-close').onclick = () => { $('#settings').hidden = true; };
    $('#set-name').value = state.name;
    $('#set-accent').value = state.settings.accent;
    $('#set-rate').value = state.settings.rate;
    $('#set-auto').checked = state.settings.autoListen;
    $('#set-ai').checked = state.settings.aiChat;
    $('#set-name').onchange = (e) => { state.name = e.target.value.trim(); save(); };
    $('#set-accent').onchange = (e) => { state.settings.accent = e.target.value; pickVoice(); save(); };
    $('#set-rate').oninput = (e) => { state.settings.rate = +e.target.value; save(); };
    $('#set-auto').onchange = (e) => { state.settings.autoListen = e.target.checked; save(); };
    $('#set-ai').onchange = (e) => { state.settings.aiChat = e.target.checked; save(); };
    $('#set-reset').onclick = () => {
      if (!confirm('Reset all progress, stars and name?')) return;
      state.progress = {}; state.idx = 0; state.name = ''; save();
      $('#set-name').value = '';
      renderDrawer(); renderStars();
      $('#settings').hidden = true;
      startLesson(0);
    };
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goBack();
      else if (e.key === ' ') { e.preventDefault(); $('#mic').click(); }
    });
  }

  async function checkAI() {
    try {
      const r = await fetch('api/health');
      const d = await r.json();
      state.ai = !!d.ai;
    } catch (e) { state.ai = false; }
    $('#ai-status').textContent = state.ai ? '🟢 AI brain connected — Pip can answer any question.' : '⚪ AI brain off — Pip answers phonics questions only. Run server.py with ANTHROPIC_API_KEY to turn it on.';
  }

  load();
  wire();
  renderDrawer();
  renderStars();
  renderLesson(lessonOf(state.idx));
  showBubble(state.name ? `Welcome back, ${state.name}! Tap "Let's Play" to start.` : 'Hi! Tap "Let\'s Play" to start!');
  if (!SR) $('#no-sr').hidden = false;
  checkAI();

  // exposed for automated tests
  window.__pip = { state, startLesson, deliver, LESSONS };
})();
