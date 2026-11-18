'use strict';
// The installed list: how a Recon Towers app is found when it's on this computer but not running. Each app leaves
// `installed/<id>.json` in the App Link folder, and the others read it. docs/design/the-suite.md has the reasoning.
//
// The file holds no secrets: the app's id, name, version and the path to start it. Any program running as this person
// could write one, so nothing here starts a program unless the id is one of the suite's own, the path is a real file and,
// off Windows, it can be run.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL = 1;
const SUITE_IDS = ['rt-markdown-reader', 'rt-story-tracker', 'rt-author-desk', 'rt-press', 'rt-audio-studio'];
const FOLDER = 'installed';
const MAX_PATH = 1024;

const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
const clean = (text, fallback = '') => (typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, 80) : '') || fallback;
const isMacBundle = (file) => /\.app$/i.test(file);

// The thing to start: on a Mac the .app that holds the running program, elsewhere the program itself. An AppImage is
// started through the AppImage, not the program unpacked inside it.
function launchPathFor({ execPath, appImage, platform = process.platform }) {
  if (appImage) return appImage;
  if (platform === 'darwin') {
    const at = execPath.search(/\.app(\/|$)/i);
    return at >= 0 ? execPath.slice(0, at + 4) : execPath;
  }
  return execPath;
}

function folderOf(shared) {
  return path.join(shared, FOLDER);
}

function writeInstalled(shared, { id, name, version, launch }) {
  if (!validId(id) || typeof launch !== 'string' || !path.isAbsolute(launch) || launch.length > MAX_PATH) return false;
  const dir = folderOf(shared);
  const file = path.join(dir, `${id}.json`);
  const text = `${JSON.stringify({ id, name: clean(name, id), version: clean(String(version ?? '')), launch, protocol: PROTOCOL }, null, 2)}\n`;
  try {
    if (fs.readFileSync(file, 'utf8') === text) return true;
  } catch {
    // Not there yet, or unreadable: written below.
  }
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
  return true;
}

function removeInstalled(shared, id) {
  if (validId(id)) fs.rmSync(path.join(folderOf(shared), `${id}.json`), { force: true });
}

// Is this a program that could be started? A Mac app is a folder, so it only has to be there.
function startable(launch, platform) {
  try {
    const stat = fs.statSync(launch);
    if (platform === 'darwin' && isMacBundle(launch)) return stat.isDirectory();
    if (!stat.isFile()) return false;
    if (platform === 'win32') return /\.exe$/i.test(launch);
    fs.accessSync(launch, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Every app that says it's installed. A file for an app that's gone, whose path no longer leads anywhere, is cleared away.
function readInstalled(shared, { platform = process.platform, exists = fs.existsSync } = {}) {
  let names = [];
  try {
    names = fs.readdirSync(folderOf(shared));
  } catch {
    return [];
  }
  const found = [];
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    const file = path.join(folderOf(shared), name);
    let info;
    try {
      info = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (info?.protocol !== PROTOCOL || !validId(info.id) || `${info.id}.json` !== name) continue;
    if (typeof info.launch !== 'string' || !path.isAbsolute(info.launch) || info.launch.length > MAX_PATH) continue;
    if (!exists(info.launch)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    found.push({ id: info.id, name: clean(info.name, info.id), version: clean(String(info.version ?? '')), launch: info.launch, known: SUITE_IDS.includes(info.id) });
  }
  return found;
}

// Starts an installed app: one of the suite's own, and a real program. It's given no arguments, and no shell reads the path.
function launchInstalled(entry, { platform = process.platform, start = spawn } = {}) {
  if (!entry?.known) throw new Error('This app only starts the Recon Towers apps.');
  if (!startable(entry.launch, platform)) throw new Error(`${entry.name} can’t be found where it was installed.`);
  const [command, args] = platform === 'darwin' && isMacBundle(entry.launch) ? ['open', ['-a', entry.launch]] : [entry.launch, []];
  start(command, args, { detached: true, stdio: 'ignore', shell: false }).unref();
}

module.exports = { SUITE_IDS, clean, launchInstalled, launchPathFor, readInstalled, removeInstalled, startable, validId, writeInstalled };
