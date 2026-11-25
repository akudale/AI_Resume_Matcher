# 🦜 Pip Phonics: a talking, listening phonics tutor for ages 4–5

Pip is a friendly parrot who **talks** to your child, **listens** to them through the microphone, and
answers back. Pip teaches English phonics through a full syllabus, from first letter sounds up to reading
whole sentences. Your child can move **forward, back, or jump to any lesson** just by saying so.

## Run it

```bash
cd phonics_tutor
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-...   # optional: turns on Pip's AI brain for any question
python server.py                  # open http://localhost:8000 in Chrome, Edge or Safari
```

You can also skip the server and open `static/index.html` directly. Everything works except the AI brain.
Listening needs a browser that has speech recognition (Chrome, Edge or Safari). In other browsers,
children can tap the answers and grown-ups can type.

## What makes Pip feel like a real tutor

- **A natural voice.** On the published claude.ai page Pip uses Claude's voice. When run locally, Pip picks the most human voice on the device, preferring the "Natural" / "Online" voices in Edge and Chrome. Grown-ups can choose a voice in ⚙️ settings.
- **Real recorded letter sounds.** Each of the 40 phonics sounds plays from a recording in `static/sounds/` when one is there, and falls back to the voice when not (see below).
- **Hands-free.** Pip listens by itself after every question; it never listens while it is talking, so it doesn't hear itself. On the published page, Claude's voice and the microphone can't be on together, so with that voice the child taps the orange button to answer.
- **Patient when the child is quiet.** After 10 seconds: "Take your time!" After 22: Pip shows how. After 40: "I'll wait right here."
- **Feedback like a teacher.** *"You said **fun**! So close! **Sun** starts with **sss**."* Pip points out whether the start, middle or end sound was different.
- **Memory.** *"Welcome back, Maya! Yesterday you learned the letter D. That's 3 days in a row! Remember D? That one was tricky."*
- **Personality.** Praise varies (and celebrates "three in a row!" or trying again), Pip sometimes gets a picture wrong on purpose so the child can correct it, and it has a favourite food (crackers).

## Adding the sound recordings

Pip needs one short clip per sound, named by the sound's id:

```bash
python build_sounds.py --list     # the 40 ids, e.g. s.mp3 /s/ as in sun, sh.mp3 /ʃ/ as in ship
# copy the clips into static/sounds/, then:
python build_sounds.py            # writes static/sounds/manifest.json
```

Clips can be added a few at a time; any sound without one is spoken by the voice.

## How a lesson works

Each lesson has 4 steps, shown at the top of the screen:

1. **👀 Learn**: Pip shows the letter or sound with a picture, says the sound, and gives a fun action (for example, *"s says ssss, like a hissing snake"*).
2. **🗣️ Say it**: Pip sounds out each word (*"kuh… ah… tuh… cat!"*) and the child says it back. Pip listens and checks.
   Pip is forgiving with young voices (close pronunciations, plurals, "6" for "six"). After a miss Pip models the word again. After 2 misses Pip gently says the answer and moves on.
3. **🎮 Game**: a quiz with picture options (*"Which one starts with S?"*, *"Which word has sh?"*, *"Find the word cat"*). The child can say the word, say "the first one", or tap.
4. **⭐ Done**: stars, confetti, then *"Shall we go to the next lesson?"*

Progress, stars, the child's name and settings are saved in the browser.

## Syllabus (62 lessons)

| Band | Level | Lessons |
|---|---|---|
| Beginner | 1. Letter Sounds | s a t p i n m d g o c k e u r h b f l j v w x y z q (teaching order like Jolly Phonics) |
| Beginner | 2. Blending Words | CVC words with short a, e, i, o, u (cat, hen, pig, dog, sun) |
| Intermediate | 3. Two Letters, One Sound | sh, ch, th, ck, ng, wh, ph |
| Intermediate | 4. Blends | bl/cl/fl, st/sp/sn, tr/dr/fr, gr/br/cr, nd/nk/mp |
| Intermediate | 5. Magic e | a_e, i_e, o_e, u_e |
| Advanced | 6. Vowel Teams | ai/ay, ee/ea, oa/ow, oo, ar, or, er/ir/ur, ou/ow, oi/oy |
| Advanced | 7. Tricky Words | the, I, is, to, said, was, they… |
| Advanced | 8. Reading Sentences | "I see a cat." → "She said the cake is good." |

Tap **📚 Lessons** to see the whole syllabus and jump anywhere.

## Things the child (or a grown-up) can say

| Say | Pip does |
|---|---|
| "next", "move on", "yes" (at the end) | next lesson |
| "go back", "previous" | previous lesson |
| "again", "repeat", "say it again" | repeats the question |
| "start again" | restarts this lesson |
| "lesson 12", "go to lesson twenty", "level 3" | jumps there |
| "teach me sh", "the letter B", "magic e o", "short u", "tricky words" | jumps to that sound |
| "skip" | skips this question |
| "help", "I don't know" | Pip shows and says the answer |
| "show me the lessons" | opens the syllabus |
| "stop", "wait" | Pip stops talking and waits |
| "What sound does B make?", "How do you spell cat?", "What starts with M?" | answered straight away |
| any other question ("Why do parrots talk?") | answered by the AI brain in kid-friendly words, if it is on |

With the AI brain on, free-form requests like *"can we do the snake sound again?"* also move to the right lesson.

**⚙️ Grown-up settings:** the child's name, accent (US, UK, Indian, Australian English), talking speed, auto-listen on or off, AI brain on or off, and reset progress.
Keyboard: ← and → change lessons, Space starts listening.

## Files

```
phonics_tutor/
├── server.py            FastAPI: serves the app + /api/chat (Claude) + /api/health
├── build_sounds.py      registers recordings in static/sounds/
├── build_page.py        bundles the app into one page for publishing on claude.ai
├── static/
│   ├── index.html       UI
│   ├── styles.css
│   ├── syllabus.js      the 8-level syllabus, sounds, word sound-out
│   ├── brain.js         intent parsing, forgiving answer matching, local Q&A
│   └── app.js           speech in/out (Web Speech API), lesson flow, navigation
└── tests/brain.test.js  node --test phonics_tutor/tests/*.test.js
```

Configuration: `PHONICS_MODEL` (default `claude-haiku-5-5`, a fast model for snappy voice replies), `HOST`, `PORT`.

**Privacy:** speech recognition is done by the browser. Only typed or spoken *questions* that Pip cannot answer
itself are sent to the AI server, together with the child's first name if one was given.
