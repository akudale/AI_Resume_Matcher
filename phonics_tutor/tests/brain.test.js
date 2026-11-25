// Run: node --test phonics_tutor/tests
const test = require('node:test');
const assert = require('node:assert');
const S = require('../static/syllabus.js');
const B = require('../static/brain.js');

const L = S.LESSONS;
const intent = (t) => B.parseIntent(t, L);
const lessonNum = (id) => L.find((l) => l.id === id).num;

test('syllabus goes from beginner to advanced and is complete', () => {
  assert.strictEqual(L.length, 62);
  assert.deepStrictEqual([...new Set(L.map((l) => l.level))], [1, 2, 3, 4, 5, 6, 7, 8]);
  L.forEach((l, i) => {
    assert.strictEqual(l.num, i + 1);
    if (l.type === 'sentence') assert.ok(l.sentences.length >= 3, l.id);
    else assert.ok(l.words.length >= 4, l.id);
  });
  assert.strictEqual(new Set(L.map((l) => l.id)).size, L.length, 'ids unique');
  // every lesson word really contains the lesson's sound
  L.filter((l) => ['digraph', 'blend', 'magic', 'team'].includes(l.type)).forEach((l) => {
    l.words.forEach((w) => assert.ok(l.keys.some((k) => S.wordHasKey(w.w, k)), `${w.w} in ${l.id}`));
  });
  L.filter((l) => l.type === 'letter').forEach((l) => {
    l.words.forEach((w) => assert.ok(l.position === 'end' ? w.w.endsWith(l.keys[0]) : w.w.startsWith(l.keys[0]), `${w.w} in ${l.id}`));
  });
});

test('navigation commands', () => {
  assert.deepStrictEqual(intent('next'), { type: 'next' });
  assert.deepStrictEqual(intent('next lesson please'), { type: 'next' });
  assert.deepStrictEqual(intent('go back'), { type: 'back' });
  assert.deepStrictEqual(intent('previous one'), { type: 'back' });
  assert.deepStrictEqual(intent('say that again'), { type: 'repeat' });
  assert.deepStrictEqual(intent('start again'), { type: 'restart' });
  assert.deepStrictEqual(intent('go to lesson 12'), { type: 'gotoLesson', value: 12 });
  assert.deepStrictEqual(intent('lesson five'), { type: 'gotoLesson', value: 5 });
  assert.deepStrictEqual(intent('lesson twenty three'), { type: 'gotoLesson', value: 23 });
  assert.deepStrictEqual(intent('level 3'), { type: 'gotoLevel', value: 3 });
  assert.deepStrictEqual(intent('show me the lessons'), { type: 'menu' });
  assert.deepStrictEqual(intent("I don't know"), { type: 'help' });
  assert.deepStrictEqual(intent('from the beginning'), { type: 'gotoLesson', value: 1 });
});

test('jump to a sound by name', () => {
  assert.deepStrictEqual(intent('teach me sh'), { type: 'gotoLesson', value: lessonNum('digraph-sh') });
  assert.deepStrictEqual(intent('teach me s h'), { type: 'gotoLesson', value: lessonNum('digraph-sh') });
  assert.deepStrictEqual(intent('go to the letter b'), { type: 'gotoLesson', value: lessonNum('letter-b') });
  assert.deepStrictEqual(intent('can we do the letter bee'), { type: 'gotoLesson', value: lessonNum('letter-b') });
  assert.deepStrictEqual(intent('learn magic e'), { type: 'gotoLesson', value: lessonNum('magic-a') });
  assert.deepStrictEqual(intent("let's do magic e o"), { type: 'gotoLesson', value: lessonNum('magic-o') });
  assert.deepStrictEqual(intent('practice short u'), { type: 'gotoLesson', value: lessonNum('cvc-u') });
  assert.deepStrictEqual(intent('teach me tricky words'), { type: 'gotoLesson', value: lessonNum('sight-1') });
  assert.deepStrictEqual(intent('teach me the letter a'), { type: 'gotoLesson', value: lessonNum('letter-a') });
  assert.deepStrictEqual(intent('learn ee'), { type: 'gotoLesson', value: lessonNum('team-eeea') });
});

test('questions and small talk are not commands', () => {
  assert.deepStrictEqual(intent('what sound does b make'), { type: 'question' });
  assert.deepStrictEqual(intent('do you like dogs'), { type: 'question' });
  assert.strictEqual(intent('sun'), null);
  assert.strictEqual(intent('cat'), null);
});

test('forgiving answer matching', () => {
  assert.ok(B.matchAnswer(['sun'], 'sun'));
  assert.ok(B.matchAnswer(['the sun'], 'sun'));
  assert.ok(B.matchAnswer(['suns'], 'sun'));
  assert.ok(B.matchAnswer(['elefant'], 'elephant'));
  assert.ok(B.matchAnswer(['6'], 'six'));
  assert.ok(B.matchAnswer(['yo-yo'], 'yoyo'));
  assert.ok(B.matchAnswer(['blah', 'two'], 'to'));
  assert.ok(!B.matchAnswer(['dog'], 'cat'));
  assert.ok(!B.matchAnswer(['hat'], 'cat'));
  assert.ok(B.matchAnswer(['I see a cat'], 'I see a cat.'));
  assert.ok(B.matchAnswer(['i see cat'], 'I see a cat.'));
  assert.ok(!B.matchAnswer(['dog'], 'I see a cat.'));
  assert.ok(B.matchAnswer(['stop'], 'stop', true));
  assert.ok(!B.matchAnswer(['next'], 'net', true));
});

test('quiz option picking', () => {
  assert.strictEqual(B.matchOption(['fish'], ['sun', 'fish', 'dog']), 1);
  assert.strictEqual(B.matchOption(['the first one'], ['sun', 'fish', 'dog']), 0);
  assert.strictEqual(B.matchOption(['the last one'], ['sun', 'fish', 'dog']), 2);
  assert.strictEqual(B.matchOption(['banana'], ['sun', 'fish', 'dog']), -1);
});

test('local answers', () => {
  assert.match(B.localAnswer('What sound does the letter B make?', L).text, /B says \/buh\//);
  assert.match(B.localAnswer('what does sh say', L).text, /shhh/);
  assert.match(B.localAnswer('how do you spell cat', L).text, /C - A - T/);
  assert.match(B.localAnswer('what words start with m', L).text, /moon/);
  assert.strictEqual(B.localAnswer('why is the sky blue', L), null);
});

test('names', () => {
  assert.strictEqual(B.parseName('my name is maya'), 'Maya');
  assert.strictEqual(B.parseName("I'm Leo"), 'Leo');
  assert.strictEqual(B.parseName('Arjun'), 'Arjun');
  assert.strictEqual(B.parseName('hello'), null);
});

test('sound out words', () => {
  const sh = L.find((l) => l.id === 'digraph-sh');
  assert.deepStrictEqual(S.soundOut('fish', sh).map((p) => p.g), ['f', 'i', 'sh']);
  const magic = L.find((l) => l.id === 'magic-i');
  const kite = S.soundOut('kite', magic);
  assert.deepStrictEqual(kite.map((p) => p.say), ['kuh', 'eye', 'tuh', '']);
  assert.ok(kite[3].silent);
});

test('describe what was different', () => {
  assert.deepStrictEqual(B.describeMistake(['cap'], 'cat'), { kind: 'close', pos: 'end', index: 2, heard: 'cap' });
  assert.deepStrictEqual(B.describeMistake(['fun'], 'sun'), { kind: 'close', pos: 'start', index: 0, heard: 'fun' });
  assert.deepStrictEqual(B.describeMistake(['bit'], 'bat'), { kind: 'close', pos: 'middle', index: 1, heard: 'bit' });
  assert.strictEqual(B.describeMistake(['the dog'], 'cat').kind, 'other');
  assert.strictEqual(B.describeMistake([''], 'cat').kind, 'none');
  assert.strictEqual(B.describeMistake(['i see'], 'I see a cat.').kind, 'sentence');
});

test('phoneme tokens cover every sound used', () => {
  L.forEach((l) => l.words.forEach((w) => S.soundOut(w.w, l).forEach((p) => {
    if (p.say) assert.match(S.soundToken(p.say), /^\{\{[a-z]+\|/, `${p.say} in ${w.w}`);
  })));
  assert.strictEqual(Object.keys(S.PHONEMES).length, 40);
});

test('Pip has a personality', () => {
  assert.match(B.localAnswer("what's your favourite food", L).text, /Crackers/);
  assert.match(B.localAnswer('are you a robot', L).text, /pretend parrot/);
  assert.match(B.localAnswer('what sound does s make', L, (x) => `<${x}>`).tts, /<ssss>/);
});
