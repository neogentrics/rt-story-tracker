// Takes the shared code module (neogentrics/recon-core) into this app at a tag.
//
//   node scripts/core-sync.mjs v0.1.0            copy the shared files and write core.lock
//   node scripts/core-sync.mjs v0.1.0 --check    compare the copies here with that tag; writes nothing
//   --source <url or folder>                     where to clone from (default: the GitHub repository)
//
// Only a person with access to recon-core needs to run this. The copies and core.lock are committed, so building and
// testing the app (and CI) never reach for the other repository: test/core.test.mjs recomputes the hashes from the files
// here and fails if one was edited, removed or added to. It clones with the Git login already on this computer; no token
// is read, written down or printed.
//
// Never edit a file under src/main/core/. Change it in recon-core, tag it there, and run this with the new tag.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORY = 'neogentrics/recon-core';
export const PIECES = ['read-aloud'];          // the folders of recon-core this app takes in
export const INTO = 'src/main/core';           // inside src/main/, which is what the installer packages
export const LOCK = 'core.lock';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Every file (or anything else that isn't a folder) under `dir`, as sorted paths with forward slashes. */
function filesUnder(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
    .sort();
}

/** One hash for the lot: each file's path and hash, in order. */
export function combinedHash(hashes) {
  return sha256(Object.keys(hashes).sort().map((name) => `${name} ${hashes[name]}\n`).join(''));
}

/** What's wrong with the shared code in the app at `root`, in words; an empty list when it is what core.lock says. */
export function verify(root) {
  let lock;
  try { lock = JSON.parse(fs.readFileSync(path.join(root, LOCK), 'utf8')); } catch (err) { return [`${LOCK} can’t be read: ${err.message}`]; }
  const problems = [];
  const listed = {};
  for (const [piece, entry] of Object.entries(lock.pieces || {})) {
    for (const [name, hash] of Object.entries(entry.files || {})) listed[`${piece}/${name}`] = hash;
  }
  for (const piece of PIECES) if (!lock.pieces?.[piece]) problems.push(`${LOCK} doesn’t list ${piece}`);
  const here = {};
  for (const name of filesUnder(path.join(root, INTO))) {
    const file = path.join(root, INTO, name);
    if (!fs.lstatSync(file).isFile()) { problems.push(`${INTO}/${name} isn’t an ordinary file`); continue; }
    here[name] = sha256(fs.readFileSync(file));
    if (!listed[name]) problems.push(`${INTO}/${name} isn’t in ${LOCK}`);
  }
  for (const [name, hash] of Object.entries(listed)) {
    if (!here[name]) problems.push(`${INTO}/${name} is missing`);
    else if (here[name] !== hash) problems.push(`${INTO}/${name} was changed here: change it in ${REPOSITORY} instead`);
  }
  if (combinedHash(here) !== lock.hash) problems.push(`the hash of ${INTO} doesn’t match ${LOCK}`);
  // The packages the shared code needs are the app's to install (as build packages too: Reader bundles them in).
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dependencies = { ...pkg.devDependencies, ...pkg.dependencies };
  for (const [piece, entry] of Object.entries(lock.pieces || {})) {
    for (const [name, range] of Object.entries(entry.dependencies || {})) {
      if (dependencies[name] !== range) problems.push(`${piece} needs ${name} ${range}; package.json has ${dependencies[name] || 'none'}`);
    }
  }
  return problems;
}

const hideLogins = (text) => String(text).replace(/\/\/[^/@\s]+@/g, '//***@');

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
  } catch (err) {
    throw new Error(`git ${args.find((a) => !a.startsWith('-') && !a.includes('=')) || ''} failed: ${hideLogins(err.stderr || err.message).trim()}`);
  }
}

/** The tag's files, read from a fresh clone: { commit, pieces: { name: { dependencies, files: { name: bytes } } } }. */
function fetchTag(tag, source) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`“${tag}” isn’t a tag like v1.2.3. Shared code is only taken in at a tag.`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-sync-'));
  try {
    git(['-c', 'core.autocrlf=false', '-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', tag, source, dir]);
    const commit = git(['-C', dir, 'rev-parse', 'HEAD']);
    // --branch takes a branch's name too, so make sure this really is the tag.
    let tagged = '';
    try { tagged = git(['-C', dir, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`]); } catch { /* not a tag */ }
    if (tagged !== commit) throw new Error(`${tag} isn’t a tag in ${REPOSITORY}`);
    const modules = JSON.parse(fs.readFileSync(path.join(dir, 'modules.json'), 'utf8'));
    const pieces = {};
    for (const piece of PIECES) {
      const entry = modules[piece];
      if (!entry?.files?.length) throw new Error(`${tag} has no ${piece}`);
      const files = {};
      for (const name of [...entry.files].sort()) {
        if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) throw new Error(`${piece}: “${name}” isn’t a plain file name`);
        const file = path.join(dir, piece, name);
        if (!fs.lstatSync(file).isFile()) throw new Error(`${piece}/${name} isn’t an ordinary file`);
        files[name] = fs.readFileSync(file);
      }
      pieces[piece] = { dependencies: entry.dependencies || {}, files };
    }
    return { commit, pieces };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function lockFor(tag, { commit, pieces }) {
  const all = {};
  const out = {};
  for (const [piece, { dependencies, files }] of Object.entries(pieces)) {
    const hashes = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]));
    for (const [name, hash] of Object.entries(hashes)) all[`${piece}/${name}`] = hash;
    out[piece] = { dependencies, files: hashes };
  }
  return { source: REPOSITORY, tag, commit, into: INTO, pieces: out, hash: combinedHash(all) };
}

/** Copy the tag into the app at `root` (or with `check`, only compare). Returns { lock, problems }. */
export function sync({ root, tag, source = `https://github.com/${REPOSITORY}.git`, check = false }) {
  const got = fetchTag(tag, source);
  const lock = lockFor(tag, got);
  let before = null;
  try { before = JSON.parse(fs.readFileSync(path.join(root, LOCK), 'utf8')); } catch { /* the first time */ }
  if (before?.tag === tag && before.commit !== got.commit) {
    throw new Error(`The tag ${tag} has moved: ${LOCK} has commit ${before.commit}, and the tag now points to ${got.commit}. Make a new tag instead.`);
  }
  if (check) {
    const problems = verify(root);
    if (JSON.stringify(before) !== JSON.stringify(lock)) problems.push(`${LOCK} isn’t what ${tag} gives`);
    return { lock, problems };
  }
  for (const [piece, { files }] of Object.entries(got.pieces)) {
    const to = path.join(root, INTO, piece);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(to, { recursive: true });
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(to, name), bytes);
  }
  fs.writeFileSync(path.join(root, LOCK), `${JSON.stringify(lock, null, 2)}\n`);
  return { lock, problems: verify(root) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--source');
  const source = at === -1 ? undefined : args.splice(at, 2)[1];
  const check = args.includes('--check');
  const [tag] = args.filter((a) => a !== '--check');
  if (!tag) {
    console.error('Usage: node scripts/core-sync.mjs <tag> [--check] [--source <url or folder>]');
    process.exit(2);
  }
  try {
    const { lock, problems } = sync({ root: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), tag, check, ...(source ? { source } : {}) });
    if (problems.length) {
      console.error(problems.map((p) => `✖ ${p}`).join('\n'));
      process.exit(1);
    }
    console.log(`${check ? 'Matches' : 'Took in'} ${REPOSITORY} ${lock.tag} (${lock.commit.slice(0, 7)}): ${Object.keys(lock.pieces).join(', ')}`);
  } catch (err) {
    console.error(`✖ ${hideLogins(err.message)}`);
    process.exit(1);
  }
}
