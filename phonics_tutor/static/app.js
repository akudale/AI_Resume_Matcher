/* Pip the Phonics Parrot — interactive voice phonics tutor for ages 4-5. */
(function () {
  'use strict';
  const Syl = window.PhonicsSyllabus;
  const { LEVELS, LESSONS, soundOut, wordHasKey } = Syl;
  const Brain = window.PhonicsBrain;
  const $ = (s) => document.querySelector(s);
  const STORE_KEY = 'pip-phonics-v1';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // When Pip runs as a published claude.ai page, the platform can provide
  // dictation (listening) and Claude (answering questions). Both are optional.
  const platform = { dictation: null, sample: null, tts: null };

  // ---------------------------------------------------------------- state
  const state = {
    idx: 0,
    progress: {}, // lessonId -> {stars, done, date}
    stats: {}, // lessonId -> {right, wrong, last}: what Pip remembers about each sound
    lastVisit: '',
    streak: 0,
    name: '',
    settings: { accent: 'en-US', rate: 0.9, autoListen: true, aiChat: true, voice: 'auto', claudeVoice: 'airy' },
    ai: false,
    chat: [],
  };
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (typeof s.idx === 'number') state.idx = Math.max(0, Math.min(LESSONS.length - 1, s.idx));
      state.progress = s.progress || {};
      state.stats = s.stats || {};
      state.lastVisit = s.lastVisit || '';
      state.streak = s.streak || 0;
      state.name = s.name || '';
      Object.assign(state.settings, s.settings || {});
    } catch (e) { /* private mode etc. */ }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        idx: state.idx, progress: state.progress, name: state.name, settings: state.settings,
        stats: state.stats, lastVisit: state.lastVisit, streak: state.streak,
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- recorded sounds
  // static/sounds/manifest.json maps phoneme id -> file. Missing clips fall back to speech.
  let clips = {};
  let currentAudio = null;
  fetch('sounds/manifest.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { clips = (m && m.files) || {}; })
    .catch(() => { clips = {}; });

  function playClip(id, token) {
    return new Promise((resolve) => {
      if (token !== speechToken || hurry) return resolve();
      const a = new Audio(`sounds/${clips[id]}`);
      currentAudio = a;
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); if (currentAudio === a) currentAudio = null; resolve(); } };
      const timer = setTimeout(finish, 4000);
      a.onended = finish;
      a.onerror = finish;
      a.play().catch(finish);
    });
  }

  // ---------------------------------------------------------------- speaking
  let speechToken = 0;
  let hurry = false; // child spoke or tapped mid-speech: skip talking until we listen
  let speaking = false;
  let speakEndedAt = 0;
  let voice = null;
  let claudeVoiceDown = false; // Claude voice failed this session: use the device voice
  let claudeVoiceOff = false; // the viewer turned Claude's voice off: text only, don't substitute

  const useClaudeVoice = () => !!platform.tts && state.settings.voice === 'claude' && !claudeVoiceDown;

  function pickVoice() {
    if (!window.speechSynthesis) return;
    const voices = speechSynthesis.getVoices();
    const chosen = state.settings.voice;
    if (chosen && chosen !== 'auto' && chosen !== 'claude') {
      const v = voices.find((x) => x.voiceURI === chosen);
      if (v) { voice = v; return; }
    }
    const acc = state.settings.accent;
    const en = voices.filter((v) => /^en/i.test(v.lang));
    // Neural "Natural"/"Online" voices (Edge, Chrome, Safari) sound far more human.
    const score = (v) => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 8 : 0)
      + (/google/i.test(v.name) ? 4 : 0)
      + (v.lang.replace('_', '-') === acc ? 3 : 0)
      + (/female|aria|jenny|ava|emma|libby|sonia|neerja|natasha|samantha|zira|heera|karen|moira/i.test(v.name) ? 2 : 0)
      + (v.localService === false ? 1 : 0);
    voice = en.slice().sort((a, b) => score(b) - score(a))[0] || null;
    renderVoiceOptions();
  }
  if (window.speechSynthesis) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function deviceSpeak(text, token) {
    const parts = text.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
    return parts.reduce((chain, part) => chain.then(() => new Promise((resolve) => {
      if (token !== speechToken || hurry) return resolve();
      const fallbackMs = 1500 + part.length * 90;
      if (!window.speechSynthesis) return setTimeout(resolve, Math.min(fallbackMs, 400 + part.length * 30));
      const u = new SpeechSynthesisUtterance(part);
      if (voice) u.voice = voice;
      u.lang = (voice && voice.lang) || state.settings.accent;
      u.rate = state.settings.rate;
      u.pitch = 1.05;
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(finish, fallbackMs); // some browsers never fire onend
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    })), Promise.resolve());
  }

  async function claudeSpeak(text, token) {
    if (token !== speechToken || hurry) return;
    try {
      await platform.tts.speak(text, {
        voice: state.settings.claudeVoice || 'airy',
        rate: Math.max(0.7, Math.min(1.5, state.settings.rate + 0.1)),
        language: 'en',
      });
    } catch (e) {
      const code = e && e.code;
      if (code === 'stopped') return;
      if (code === 'not_granted') {
        claudeVoiceOff = true;
        toast("Pip's Claude voice is turned off for this page. Pick another voice in ⚙️ settings.");
        return;
      }
      if (code === 'rate_limited' || code === 'unavailable') {
        claudeVoiceDown = true;
        toast("Claude's voice needs a rest, so Pip is using this device's voice for now.");
      }
      await deviceSpeak(text, token); // busy / no_gesture / errors: say it with the device voice
    }
  }

  /** Split speech text into spoken text and {{id|fallback}} recorded sounds. */
  function segments(text) {
    const out = [];
    const re = /\{\{([a-z]+)\|([^}]*)\}\}/g;
    let last = 0;
    let m;
    const pushText = (t) => {
      if (!t) return;
      const prev = out[out.length - 1];
      if (prev && prev.text != null) prev.text += t; else out.push({ text: t });
    };
    while ((m = re.exec(text))) {
      pushText(text.slice(last, m.index));
      if (clips[m[1]]) out.push({ clip: m[1] }); else pushText(m[2]);
      last = re.lastIndex;
    }
    pushText(text.slice(last));
    return out.map((s) => (s.text != null ? { text: s.text.replace(/\s+/g, ' ').trim() } : s))
      .filter((s) => s.clip || /[a-z0-9]/i.test(s.text));
  }

  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;

  /** Show `text` in Pip's bubble and speak it (or `tts` if given). */
  async function say(text, tts) {
    showBubble(text);
    if (hurry || claudeVoiceOff) return;
    const token = speechToken;
    pauseListening();
    speaking = true;
    setTalking(true);
    try {
      for (const seg of segments(String(tts || text).replace(EMOJI, ''))) {
        if (token !== speechToken || hurry) break;
        if (seg.clip) await playClip(seg.clip, token);
        else if (useClaudeVoice()) await claudeSpeak(seg.text, token);
        else await deviceSpeak(seg.text, token);
      }
    } finally {
      if (token === speechToken) {
        speaking = false;
        speakEndedAt = Date.now();
        setTalking(false);
        resumeListening();
      }
    }
  }
  function cancelSpeech() {
    speechToken++;
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (platform.tts && platform.tts.active()) platform.tts.stop().catch(() => {});
    if (currentAudio) { try { currentAudio.pause(); } catch (e) { /* */ } currentAudio = null; }
    speaking = false;
    speakEndedAt = Date.now();
    setTalking(false);
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, hurry ? 0 : ms));
  const snd = Syl.soundToken;

  // ---------------------------------------------------------------- listening
  // Three ways to listen:
  //  'native'    – the browser's own recogniser, re-armed automatically while Pip waits (hands-free)
  //  'dictation' – the claude.ai page's dictation, opened once and kept open (hands-free)
  //  'tap'       – one phrase per tap on the 🎤 (needed with Claude's voice: it can't talk while the mic is open)
  let rec = null;
  let listening = false;
  let micBlocked = false;
  let dict = { on: false, mode: 'session', text: '' };

  function listenMode() {
    if (!state.settings.autoListen) return 'tap';
    if (platform.dictation) return useClaudeVoice() ? 'tap' : 'dictation';
    if (SR && !micBlocked) return 'native';
    return 'tap';
  }

  function listenOnce() {
    return new Promise((resolve) => {
      if (!SR || micBlocked) return resolve({ unsupported: true });
      if (rec) stopListening();
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
          toast('The microphone is blocked. Allow it in the browser, or tap and type instead.');
        }
      };
      r.onend = () => {
        if (rec === r) { rec = null; setListening(false); }
        resolve(got || { timeout: true });
      };
      try { r.start(); setListening(true); } catch (e) { if (rec === r) rec = null; setListening(false); resolve({ timeout: true }); }
    });
  }
  function stopListening() {
    if (rec) { const r = rec; rec = null; try { r.abort(); } catch (e) { /* */ } }
    if (!dict.on) setListening(false);
  }

  // Native hands-free: keep a recogniser open whenever Pip is waiting and not talking.
  function armNative() {
    if (listenMode() !== 'native' || !waiter || speaking || rec) return;
    listenOnce().then((r) => {
      if (r.alts) { deliver({ alts: r.alts, text: r.text, source: 'voice' }); return; }
      if (!r.unsupported && !micBlocked) setTimeout(armNative, 120);
    });
  }
  function pauseListening() { if (rec) stopListening(); }
  function resumeListening() { setTimeout(armNative, 250); }

  // Dictation (claude.ai page).
  function setupDictation(d) {
    platform.dictation = d;
    $('#no-sr').hidden = true;
    d.onPartial(({ text }) => {
      if (text && !speaking && Date.now() - speakEndedAt > 600) showHeard((`${dict.text} ${text}`).trim(), true);
    });
    d.onFinal(({ text }) => {
      // Ignore Pip's own voice coming back through the speakers.
      if (speaking || Date.now() - speakEndedAt < 700) return;
      if (dict.mode === 'session') {
        const said = String(text || '').trim();
        // Between questions, only commands count (so background chatter can't skip Pip's words).
        if (said && (waiter || Brain.parseIntent(said, LESSONS))) deliver({ alts: [said], text: said, source: 'voice' });
        return;
      }
      dict.text = `${dict.text} ${text}`.trim();
      if (dict.text) d.stop().catch(() => {}); // tap mode: one phrase is one answer
    });
    d.onState(({ state: st, reason }) => {
      dict.on = st !== 'idle';
      setListening(st === 'starting' || st === 'listening');
      if (st !== 'idle') return;
      const said = dict.text.trim();
      dict.text = '';
      if (said) deliver({ alts: [said], text: said, source: 'voice' });
      if (reason === 'not_granted') toast('The microphone is off for this page. You can tap and type instead!');
      else if (reason === 'unavailable') { platform.dictation = null; toast('Listening is not available here. You can tap and type instead!'); }
      else if (reason === 'rate_limited' || reason === 'upstream_error') toast('I could not hear that. Tap the 🎤 and try again!');
      else if (dict.mode === 'session' && (reason === 'hidden' || reason === 'viewer_stopped' || reason === 'time_limit')) nudgeMic(true);
    });
  }
  /** Must run straight from a click or key press. */
  function startDictation(mode) {
    const d = platform.dictation;
    if (!d) return;
    dict.mode = mode;
    dict.text = '';
    d.start({ language: 'en' }).catch((e) => {
      if (e && e.code === 'not_granted') toast('The microphone is off for this page. You can tap and type instead!');
      else if (e && e.code === 'unavailable') { platform.dictation = null; toast('Listening is not available here. You can tap and type instead!'); }
    });
  }

  // ---------------------------------------------------------------- input routing
  // Every input (voice, typing, tapping a card) goes through deliver().
  let waiter = null;
  let pendingInput = null;
  let run = 0; // lesson-flow token: bumping it aborts the running flow
  let silenceTimers = [];

  function deliver(input) {
    if (input.text) showHeard(input.text, false);
    nudgeMic(false);
    if (waiter) {
      const w = waiter;
      waiter = null;
      clearSilence();
      cancelSpeech(); // stop any "take your time" nudge
      pauseListening();
      w(input);
      return;
    }
    // Pip was talking: remember the input and hurry to the next question.
    pendingInput = input;
    hurry = true;
    cancelSpeech();
  }

  function clearSilence() { silenceTimers.forEach(clearTimeout); silenceTimers = []; }

  /** Wait for the child. onSilence(level) is called after 10s, 22s and 40s of quiet. */
  function getInput(t, onSilence) {
    if (pendingInput) { const p = pendingInput; pendingInput = null; hurry = false; return Promise.resolve(p); }
    hurry = false;
    return new Promise((resolve) => {
      waiter = resolve;
      const mode = listenMode();
      if (mode === 'native') armNative();
      else if (mode === 'tap' || (mode === 'dictation' && !dict.on)) nudgeMic(true);
      clearSilence();
      [10000, 22000, 40000].forEach((ms, i) => {
        silenceTimers.push(setTimeout(() => {
          if (waiter === resolve && t === run && !speaking && onSilence) onSilence(i + 1);
        }, ms));
      });
    });
  }

  // ---------------------------------------------------------------- lesson engine
  const PRAISE = ['Yes! 🌟', 'You got it!', 'Great job!', 'Brilliant!', 'Wow, well done!', 'Perfect!', 'Super!',
    "That's it!", 'Fantastic!', 'Woo-hoo! 🎉', 'Nailed it!', 'Spot on!', 'Clever you! 🦜'];
  const PRAISE_NAMED = ['Yes, {n}! 🌟', 'Great job, {n}!', 'Brilliant, {n}!', 'You got it, {n}!'];
  const PRAISE_RETRY = ['You kept trying, and you got it! 💪', 'Yes! Trying again worked! 🌟', "There it is! Well done for not giving up!", 'Yes! See, you can do it! 🎉'];
  const SAY_IT = ['Your turn!', 'Now you!', 'You try!', 'Can you say it?'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let lastLine = '';
  /** Pick a line, avoiding saying the same one twice in a row. */
  const fresh = (a) => { let x = pick(a); for (let i = 0; i < 3 && x === lastLine; i++) x = pick(a); lastLine = x; return x; };
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const kid = () => (state.name ? `, ${state.name}` : '');

  let score = { first: 0, total: 0 };
  let inARow = 0;
  let currentLesson = null;
  let currentAsk = null; // {model} for "help" / "I don't know"

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

  /** Update the visit streak and build a greeting from what Pip remembers. */
  function memoryGreeting(lesson) {
    const now = today();
    const gap = state.lastVisit ? daysBetween(state.lastVisit, now) : null;
    if (gap === null || gap > 1) state.streak = 1;
    else if (gap === 1) state.streak = (state.streak || 0) + 1;
    state.lastVisit = now;
    save();
    const n = state.name;
    const lines = [];
    const doneList = LESSONS.filter((l) => (state.progress[l.id] || {}).done);
    const lastDone = doneList.slice().sort((a, b) => String((state.progress[b.id] || {}).date || '').localeCompare(String((state.progress[a.id] || {}).date || '')))[0];
    if (gap === null || !doneList.length) {
      lines.push(fresh([`Hi ${n}! 🦜 Let's learn some sounds!`, `Hello ${n}! Ready to play with sounds? 🦜`]));
    } else if (gap === 0) {
      lines.push(fresh([`You're back, ${n}! Yay! 🦜`, `Hello again, ${n}! More sounds? Let's go! 🦜`]));
    } else if (gap === 1) {
      lines.push(`Welcome back, ${n}! 🦜`);
      if (lastDone) lines.push(`Yesterday you learned ${lastDone.type === 'letter' ? `the letter ${lastDone.keys[0].toUpperCase()}` : lastDone.title}. Good job!`);
      if (state.streak >= 2) lines.push(`That's ${state.streak} days in a row! 🔥`);
    } else {
      lines.push(`${n}! I missed you! It's been ${gap} days. 🦜`);
    }
    // Remember a sound that was tricky last time.
    const tricky = doneList.map((l) => ({ l, st: state.stats[l.id] })).filter((x) => x.st && x.st.wrong >= 2 && x.st.wrong >= x.st.right)
      .sort((a, b) => b.st.wrong - a.st.wrong)[0];
    if (tricky && gap !== 0 && tricky.l.keys[0]) {
      lines.push(`Remember ${tricky.l.type === 'letter' ? tricky.l.keys[0].toUpperCase() : tricky.l.display.replace(/_/g, '…')}? That one was tricky. Say "practise ${tricky.l.keys[0].replace('_e', ' magic e')}" any time!`);
    }
    if (doneList.length) lines.push(`Today, let's do lesson ${lesson.num}: ${lesson.title}!`);
    return lines.join(' ');
  }

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
  async function ask(t, { prompt, tts, again, check, exact, model, onWrong, tries = 2 }) {
    let attempts = 0;
    let silent = false;
    let first = true;
    currentAsk = { model };
    const short = again || prompt;
    const onSilence = async (level) => {
      if (level === 1) await say(fresh([`Take your time${kid()}! ${short}`, `I'm listening! ${short}`, `Hmm? ${short}`]));
      else if (level === 2) {
        if (model) { await say(fresh(["Let's do it together.", "I'll help you!"])); if (t !== run) return; await model(); if (t !== run) return; await say(fresh(SAY_IT)); } else await say(short);
      } else {
        await say(listenMode() === 'tap'
          ? "I'll wait right here. Tap the big orange button when you want to talk to me!"
          : "I'll wait right here. You can say 'help', or tap a picture!");
      }
    };
    while (true) {
      if (!silent) await say(first ? prompt : short, first ? tts : undefined);
      silent = false;
      first = false;
      if (t !== run) return null;
      const inp = await getInput(t, onSilence);
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
      if (onWrong) await onWrong(inp, attempts);
      else {
        await say(fresh(["Good try! Let's try again.", 'Almost! Listen once more.', 'Nice try! One more time.']));
        if (t !== run) return null;
        if (model) await model();
      }
      if (t !== run) return null;
    }
  }

  /** Tell the child exactly what was different, like a real teacher would. */
  async function wordFeedback(inp, word, lesson) {
    const W = word;
    const m = Brain.describeMistake(inp.alts, word);
    const parts = soundOut(word, lesson);
    if (m.kind === 'close') {
      // Find the sound (grapheme) that holds the first wrong letter.
      let at = 0;
      let k = parts.findIndex((p) => { const hit = m.index < at + p.g.length; at += p.g.length; return hit; });
      if (k < 0) k = parts.length - 1;
      const part = parts[k];
      const pos = k === 0 ? 'start' : k === parts.length - 1 ? 'end' : 'middle';
      const spokenAll = parts.filter((p) => !p.silent).map((p) => snd(p.say)).join('... ');
      renderWord(word, lesson, parts.map((p, i) => ({ ...p, focus: i === k })));
      if (part.silent) {
        await say(`You said "${m.heard}"! Nearly! Listen: ${W}.`, `You said ${m.heard}! Nearly! Listen. ${W}.`);
      } else if (pos === 'start') {
        await say(`You said "${m.heard}"! So close! ${W} starts with /${part.g}/.`,
          `You said ${m.heard}! So close! ${W} starts with ${snd(part.say)}. ${snd(part.say)}... ${W}.`);
      } else if (pos === 'end') {
        await say(`You said "${m.heard}"! Nearly! Listen to the end: ${W}.`,
          `You said ${m.heard}! Nearly! Listen to the end. ${spokenAll}... ${W}.`);
      } else {
        await say(`I heard "${m.heard}". Listen to the middle sound: /${part.g}/. ${W}!`,
          `I heard ${m.heard}. Listen to the middle sound. ${snd(part.say)}. ${spokenAll}... ${W}!`);
      }
    } else if (m.kind === 'other') {
      await say(`Hmm, I heard "${m.heard}". Let's say "${W}" together: ${W}!`, `Hmm, I heard ${m.heard}. Let's say ${W} together. ${W}!`);
    } else {
      await say(`I didn't quite catch that. Listen: ${W}.`, `I didn't quite catch that. Listen. ${W}.`);
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
        showBubble("Okay, I'll wait. Talk to me when you're ready!");
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
    const local = Brain.localAnswer(text, LESSONS, snd);
    if (local) { await say(local.text, local.tts); return false; }
    if (platform.sample && state.settings.aiChat) return askClaude(text, t);
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
    const spoken = parts.filter((p) => !p.silent).map((p) => snd(p.say)).join('... ');
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
      tts = `Which one ${end ? 'ends' : 'starts'} with ${snd(lesson.say)}?`;
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
      const keySay = (lesson.override && lesson.override[key]) || Syl.SOUNDS[key];
      tts = key.includes('_') ? `Which word has a magic e, with ${key[0]} saying ${snd(lesson.say)}?`
        : `Which word has the ${keySay ? snd(keySay) : key} sound?`;
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
    currentLesson = lesson;
    inARow = 0;

    if (opts.greeting) { await say(opts.greeting); if (!alive()) return; }
    if (isNewLevel) { await say(`Level ${lvl.id}: ${lvl.name}! ${lvl.about}`); if (!alive()) return; }

    // ---- 1. Learn
    setStep('learn');
    const S = lesson.say ? snd(lesson.say) : '';
    if (lesson.type === 'letter') {
      const L = lesson.keys[0].toUpperCase();
      const open = fresh([`Ooh, a new letter! This is ${L}.`, `Look who's here! It's the letter ${L}.`, `Lesson ${lesson.num}! Meet the letter ${L}.`]);
      await say(`${open} ${L} says /${lesson.say}/!`, `${open} ${L} says ${S}. ${S}!`);
      if (!alive()) return;
      await say(lesson.tip); if (!alive()) return;
      const ex = lesson.words.slice(0, 3).map((w) => w.w);
      await say(`Listen: ${ex.join(', ')}.`, `Listen. ${S}... ${ex[0]}. ${S}... ${ex[1]}. ${S}... ${ex[2]}.`);
    } else if (lesson.type === 'sight') {
      await say(`Lesson ${lesson.num}: ${lesson.title}. ${lesson.tip}`);
    } else if (lesson.type === 'sentence') {
      await say(`Lesson ${lesson.num}: ${lesson.title}! Let's read some real sentences. ${lesson.tip}`);
    } else if (lesson.type === 'blend') {
      await say(`Lesson ${lesson.num}: ${lesson.title}. ${lesson.tip}`);
    } else {
      await say(`Lesson ${lesson.num}: the ${lesson.display.replace(/_/g, '…')} sound! It says /${lesson.say}/. ${lesson.tip}`,
        `Lesson ${lesson.num}. This sound says ${S}. ${S}! ${lesson.tip}`);
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
          again: 'Try reading it to me!',
          check: (inp) => Brain.matchAnswer(inp.alts, s.s, false),
          model, tries: 3,
          onWrong: async () => { await say(fresh(["Good reading! Let's read it together.", "Nearly! Let's read it together."])); if (t === run) await model(); },
        });
        if (r === null) return;
        await afterAnswer(r, s.s, t, model);
        if (!alive()) return;
      }
    } else {
      const items = lesson.type === 'sight' ? lesson.words : lesson.words.slice(0, 4);
      const sillyAt = lesson.type === 'sight' ? -1 : 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < items.length; k++) {
        const wd = items[k];
        setDots(k, items.length);
        if (k === sillyAt) {
          if (await sillyGame(t, lesson, wd) === null) return;
          if (!alive()) return;
        }
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
          again: `Say "${wd.w}"!`,
          exact: (inp) => Brain.matchAnswer(inp.alts, wd.w, true),
          check: (inp) => Brain.matchAnswer(inp.alts, wd.w, false),
          model,
          onWrong: async (inp) => { await wordFeedback(inp, wd.w, lesson); },
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
          onWrong: async (inp) => {
            const i = inp.optionIndex != null ? inp.optionIndex : Brain.matchOption(inp.alts, names);
            if (i >= 0 && i !== quiz.answer) await say(fresh([`Hmm, that's ${names[i]}. Look again!`, `Not ${names[i]}! Try another one.`]));
            else await say(fresh(['Have another look!', 'Which one could it be?']));
          },
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
    state.progress[lesson.id] = { done: true, stars: Math.max(prev.stars || 0, stars), date: today() };
    save();
    renderDrawer();
    renderStars();
    celebrate(stars);
    await say(`You finished lesson ${lesson.num}${kid()}! You got ${stars} star${stars > 1 ? 's' : ''}! ${'⭐'.repeat(stars)}`);
    if (!alive()) return;
    await doneLoop(t);
  }

  async function afterAnswer(r, answer, t) {
    score.total++;
    if (r === 'first') score.first++;
    if (currentLesson) {
      const st = state.stats[currentLesson.id] || { right: 0, wrong: 0 };
      if (r === 'first') st.right++; else if (r === 'correct' || r === 'wrong') st.wrong++;
      st.last = today();
      state.stats[currentLesson.id] = st;
      save();
    }
    if (r === 'first') {
      inARow++;
      sparkle();
      if (inARow === 3) await say("Three in a row! You're on fire! 🔥");
      else if (inARow === 5) await say('Five in a row! What a super reader! 🚀');
      else if (inARow > 0 && inARow % 8 === 0) await say(`${inARow} in a row! Wow!`);
      else await say(state.name && Math.random() < 0.3 ? fresh(PRAISE_NAMED).replace('{n}', state.name) : fresh(PRAISE));
    } else if (r === 'correct') {
      inARow = 0;
      sparkle();
      await say(fresh(PRAISE_RETRY));
    } else if (r === 'wrong') {
      inARow = 0;
      await say(fresh([`That's okay! It's "${answer}". We'll get it next time! 💪`, `No problem! It's "${answer}". You're learning! 💪`, `It's "${answer}". Tricky one! Let's keep going.`]),
        fresh([`That's okay! It's ${answer}. We'll get it next time!`, `No problem! It's ${answer}. You're learning!`]));
    }
    if (t === run) await pause(300);
  }

  /** Pip gets a picture "wrong" on purpose so the child can correct it. Not scored. */
  async function sillyGame(t, lesson, wd) {
    const pool = LESSONS.filter((l) => l !== lesson && l.type !== 'sight' && l.type !== 'sentence')
      .flatMap((l) => l.words).filter((x) => x.e && x.w !== wd.w && x.w[0] !== wd.w[0]);
    const wrong = pick(pool);
    renderWord(wd.w, lesson, soundOut(wd.w, lesson));
    const r = await ask(t, {
      prompt: `Hmm… is this a ${wrong.w}? 🤔`,
      again: `Is it a ${wrong.w}?`,
      check: (inp) => /\b(no|nope|not|silly|wrong|nah|noo+)\b/.test(Brain.normalize(inp.text || '')) || Brain.matchAnswer(inp.alts, wd.w, false),
      tries: 1,
    });
    if (r === null) return null;
    if (r === 'first') await say(fresh([`Hee hee! Silly Pip! It's a ${wd.w}! Thanks for helping me! 🦜`, `Oops! You're right, it's a ${wd.w}! Silly me! 🦜`]));
    else await say(`Hee hee, I tricked you! It's not a ${wrong.w}. It's a ${wd.w}! 🦜`);
    return r;
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
      const inp = await getInput(t, (lvl) => { if (lvl < 3) say(fresh(["What's your name?", 'Can you tell me your name?'])); });
      if (t !== run) return;
      const name = inp && (inp.optionIndex == null) ? Brain.parseName(inp.text) : null;
      if (name) { state.name = name; $('#set-name').value = name; }
      memoryGreeting(lesson); // starts the visit streak
      await say(name ? `${name}! What a lovely name! 🎉` : 'Nice to meet you, friend! 🎉');
      if (t !== run) return;
      await say(listenMode() === 'tap'
        ? 'When it is your turn, tap the big orange button and talk to me. You can say "next", "back", or ask me anything!'
        : 'Just talk to me! You can say "next", "back", "again", or ask me anything!');
      if (t !== run) return;
      startLesson(state.idx);
    } else {
      startLesson(state.idx, { greeting: memoryGreeting(lesson) });
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
  function renderVoiceOptions() {
    const sel = $('#set-voice');
    if (!sel) return;
    const voices = window.speechSynthesis ? speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
    sel.innerHTML = '';
    const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); };
    if (platform.tts) add('claude', "Claude's voice (most natural)");
    add('auto', `Best voice on this device${voice && state.settings.voice !== 'claude' ? ` (${voice.name})` : ''}`);
    voices.forEach((v) => add(v.voiceURI, `${v.name} · ${v.lang}`));
    sel.value = [...sel.options].some((o) => o.value === state.settings.voice) ? state.settings.voice : 'auto';
    $('#claude-voice-row').hidden = sel.value !== 'claude';
    $('#set-claude-voice').value = state.settings.claudeVoice || 'airy';
    $('#voice-note').textContent = sel.value === 'claude'
      ? "With Claude's voice, your child taps the orange button to answer (the microphone and this voice can't be on together)."
      : 'Pip listens by itself after each question, no tapping needed. Voices named "Natural" or "Online" (in Edge and Chrome) sound most human.';
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
    say(`${name} says /${lesson.say}/`, `${snd(lesson.say)}. ${snd(lesson.say)}.`);
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
      if (listenMode() === 'dictation') startDictation('session'); // hands-free for the whole session
      welcome();
    };
    $('#mic').onclick = () => {
      nudgeMic(false);
      const mode = listenMode();
      if (platform.dictation) {
        const d = platform.dictation;
        if (mode === 'dictation') { if (dict.on) d.stop().catch(() => {}); else startDictation('session'); return; }
        if (d.active()) { d.stop().catch(() => {}); return; }
        if (!waiter) hurry = true;
        cancelSpeech();
        startDictation('phrase');
        return;
      }
      if (rec) { stopListening(); return; }
      if (!SR || micBlocked) { $('#typed').focus(); toast('Voice listening needs Chrome, Edge or Safari. You can type instead!'); return; }
      if (!waiter) hurry = true;
      cancelSpeech();
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
    $('#set-voice').onchange = (e) => {
      state.settings.voice = e.target.value;
      state.settings.voiceChosen = true;
      claudeVoiceDown = false;
      claudeVoiceOff = false;
      pickVoice();
      save();
      renderVoiceOptions();
      cancelSpeech();
      say(fresh(["Hi! This is how I sound now. 🦜", "Hello! Do you like my new voice? 🦜"])); // a preview from the click
    };
    $('#set-claude-voice').onchange = (e) => { state.settings.claudeVoice = e.target.value; save(); cancelSpeech(); say('Hi! This is how I sound now. 🦜'); };
    $('#set-auto').checked = state.settings.autoListen;
    $('#set-ai').checked = state.settings.aiChat;
    $('#set-name').onchange = (e) => { state.name = e.target.value.trim(); save(); };
    $('#set-accent').onchange = (e) => { state.settings.accent = e.target.value; pickVoice(); save(); };
    $('#set-rate').oninput = (e) => { state.settings.rate = +e.target.value; save(); };
    $('#set-auto').onchange = (e) => { state.settings.autoListen = e.target.checked; save(); };
    $('#set-ai').onchange = (e) => { state.settings.aiChat = e.target.checked; save(); };
    let resetArmed = false;
    $('#set-reset').onclick = () => {
      if (!resetArmed) {
        resetArmed = true;
        $('#set-reset').textContent = 'Tap again to erase all progress';
        setTimeout(() => { resetArmed = false; $('#set-reset').textContent = 'Reset all progress'; }, 4000);
        return;
      }
      resetArmed = false;
      $('#set-reset').textContent = 'Reset all progress';
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

  // ---------------------------------------------------------------- claude.ai page hooks
  async function askClaude(text, t) {
    setThinking(true);
    const lesson = lessonOf(state.idx);
    const history = state.chat.slice(-6).map((m) => `${m.role === 'user' ? 'Child' : 'Pip'}: ${m.content}`).join('\n');
    const prompt = [
      'You are Pip, a cheerful parrot who teaches English phonics to children aged 4 to 5.',
      'Your reply is read aloud by a text-to-speech voice to a young child.',
      'Reply in 1 to 3 very short sentences with simple words. Be warm and encouraging. At most one emoji. No lists, links or markdown.',
      'Write letter sounds so they can be spoken, e.g. "s says ssss, like in sun".',
      'Stay safe and age-appropriate: for anything scary, grown-up or unsafe, kindly suggest asking a grown-up and steer back to sounds.',
      'If the question is off-topic, answer in one tiny sentence, then invite the child back to the lesson.',
      'If the child asks to learn a particular sound, letter, level or lesson, or an easier/harder one, set "goto" to the best lesson number below; otherwise null.',
      '',
      `Syllabus:\n${LESSONS.map((l) => `${l.num}: ${l.title} (level ${l.level})`).join('\n')}`,
      '',
      `The child is on lesson ${lesson.num}: ${lesson.title}. Words: ${lesson.words.map((w) => w.w).join(', ')}.`,
      state.name ? `The child's name is ${state.name}.` : '',
      history ? `Recent chat:\n${history}` : '',
      '',
      `The child just said: "${text}"`,
      '',
      'Answer with only JSON: {"reply": "<what Pip says>", "goto": <lesson number or null>}',
    ].join('\n');
    try {
      const data = await platform.sample.json(prompt, { modelTier: 'quick', cache: false });
      setThinking(false);
      if (t !== run) return true;
      const reply = data && typeof data.reply === 'string' ? data.reply.slice(0, 400) : '';
      const goto = data && Number.isInteger(data.goto) ? data.goto : null;
      state.chat.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      if (reply) await say(reply);
      if (goto && goto >= 1 && goto <= LESSONS.length && t === run) { startLesson(goto - 1); return true; }
      return false;
    } catch (e) {
      setThinking(false);
      if (e && e.code === 'not_granted') { platform.sample = null; aiStatus(); }
      await say("Hmm, my thinking cap fell off! Let's keep learning sounds. 🦜");
      return false;
    }
  }

  function aiStatus() {
    const on = state.ai || !!platform.sample;
    $('#ai-status').textContent = on ? '🟢 AI brain connected — Pip can answer any question.'
      : '⚪ AI brain off — Pip answers phonics questions only. Run server.py with ANTHROPIC_API_KEY to turn it on.';
  }

  function connectPlatform() {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') return;
    c.use('dictation').then((d) => { if (d) setupDictation(d); }).catch(() => {});
    c.use('tts').then((tt) => {
      if (!tt) return;
      platform.tts = tt;
      tt.onState(({ state: st }) => { if (st === 'speaking') setTalking(true); });
      if (!state.settings.voiceChosen) state.settings.voice = 'claude'; // most natural voice by default
      renderVoiceOptions();
    }).catch(() => {});
    c.use('sample').then((sm) => { if (sm) { platform.sample = sm; aiStatus(); } }).catch(() => {});
  }

  async function checkAI() {
    try {
      const r = await fetch('api/health');
      const d = await r.json();
      state.ai = !!d.ai;
    } catch (e) { state.ai = false; }
    aiStatus();
  }

  load();
  wire();
  renderDrawer();
  renderStars();
  renderLesson(lessonOf(state.idx));
  showBubble(state.name ? `Welcome back, ${state.name}! Tap "Let's Play" to start.` : 'Hi! Tap "Let\'s Play" to start!');
  if (!SR) $('#no-sr').hidden = false;
  checkAI();
  connectPlatform();

  // exposed for automated tests
  window.__pip = { state, startLesson, deliver, LESSONS };
})();
