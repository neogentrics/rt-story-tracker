// The shared code module (recon-core): the copies under src/main/core are exactly what core.lock says, and the script
// that takes them in only takes a tag. Nothing here reaches for the other repository: it's private, and CI has no access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INTO, LOCK, sync, verify } from '../scripts/core-sync.mjs';

const root = path.join(import.meta.dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, LOCK), 'utf8'));

test('core: the shared code here is exactly what core.lock says, taken in at a tag', () => {
  assert.deepEqual(verify(root), []);
  assert.match(lock.tag, /^v\d+\.\d+\.\d+$/);
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(lock.pieces['read-aloud'].files), ['supertonic.js', 'voice-text.js', 'voice-tone.js', 'voice-worker.js', 'voices.js']);
});

test('core: an edited, missing or added file is caught, and so is a package that doesn’t match', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'core-drift-'));
  fs.cpSync(path.join(root, INTO), path.join(copy, INTO), { recursive: true });
  for (const f of [LOCK, 'package.json']) fs.cpSync(path.join(root, f), path.join(copy, f));
  assert.deepEqual(verify(copy), [], 'the copy starts clean');

  const file = path.join(copy, INTO, 'read-aloud', 'voice-tone.js');
  const original = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.concat([original, Buffer.from(' ')]));          // one space more
  assert.ok(verify(copy).some((p) => /voice-tone\.js was changed here/.test(p)));

  fs.rmSync(file);
  assert.ok(verify(copy).some((p) => /voice-tone\.js is missing/.test(p)));
  fs.writeFileSync(file, original);

  for (const extra of ['read-aloud/mine.js', '.hidden', 'another/piece.js']) {
    const added = path.join(copy, INTO, extra);
    fs.mkdirSync(path.dirname(added), { recursive: true });
    fs.writeFileSync(added, 'x');
    assert.ok(verify(copy).some((p) => p.includes(`${extra} isn’t in ${LOCK}`)), extra);
    fs.rmSync(added);
  }
  assert.deepEqual(verify(copy), []);

  fs.writeFileSync(path.join(copy, LOCK), JSON.stringify({ ...lock, hash: '0'.repeat(64) }));
  assert.ok(verify(copy).some((p) => /hash .* doesn’t match/.test(p)));
  fs.cpSync(path.join(root, LOCK), path.join(copy, LOCK));

  const pkg = JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8'));
  for (const list of [pkg.dependencies, pkg.devDependencies]) delete list?.['onnxruntime-web'];
  fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify(pkg));
  assert.ok(verify(copy).some((p) => /needs onnxruntime-web/.test(p)));
});

test('core: the script copies a tag and writes the lock, and refuses a branch, a moved tag and a path that climbs out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-script-'));
  const repo = path.join(dir, 'recon-core');
  const app = path.join(dir, 'app');
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { stdio: 'pipe' });
  const put = (name, text) => { fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true }); fs.writeFileSync(path.join(repo, name), text); };
  const commit = (message) => { git('add', '-A'); git('commit', '-q', '-m', message); };

  fs.mkdirSync(repo, { recursive: true });
  git('init', '-q', '-b', 'main');
  put('modules.json', JSON.stringify({ 'read-aloud': { files: ['a.js'], dependencies: { thing: '^1.0.0' } } }));
  put('read-aloud/a.js', 'one\n');
  put('read-aloud/not-listed.js', 'stays behind\n');
  commit('first');
  git('tag', 'v1.0.0');
  fs.mkdirSync(path.join(app, INTO, 'read-aloud'), { recursive: true });
  fs.writeFileSync(path.join(app, INTO, 'read-aloud', 'old.js'), 'from before\n');
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ dependencies: { thing: '^1.0.0' } }));

  const first = sync({ root: app, tag: 'v1.0.0', source: repo });
  assert.deepEqual(first.problems, []);
  assert.deepEqual(fs.readdirSync(path.join(app, INTO, 'read-aloud')), ['a.js'], 'only the listed files, and nothing left from before');
  assert.equal(fs.readFileSync(path.join(app, INTO, 'read-aloud', 'a.js'), 'utf8'), 'one\n');
  assert.deepEqual(sync({ root: app, tag: 'v1.0.0', source: repo, check: true }).problems, []);

  fs.writeFileSync(path.join(app, INTO, 'read-aloud', 'a.js'), 'edited in the app\n');
  assert.ok(sync({ root: app, tag: 'v1.0.0', source: repo, check: true }).problems.some((p) => /was changed here/.test(p)));
  assert.equal(fs.readFileSync(path.join(app, INTO, 'read-aloud', 'a.js'), 'utf8'), 'edited in the app\n', '--check writes nothing');

  assert.throws(() => sync({ root: app, tag: 'main', source: repo }), /isn’t a tag like/);
  put('read-aloud/a.js', 'two\n');
  commit('second');
  git('branch', 'v2.0.0');                                  // a branch that only looks like a tag
  assert.throws(() => sync({ root: app, tag: 'v2.0.0', source: repo }), /isn’t a tag in/);
  git('tag', '-f', 'v1.0.0');
  assert.throws(() => sync({ root: app, tag: 'v1.0.0', source: repo }), /has moved/);

  put('modules.json', JSON.stringify({ 'read-aloud': { files: ['../modules.json'] } }));
  commit('third');
  git('tag', 'v3.0.0');
  assert.throws(() => sync({ root: app, tag: 'v3.0.0', source: repo }), /isn’t a plain file name/);
});
