'use strict';
// "What's the latest version of each Recon Towers app?" It comes from one small file on our own site, not from GitHub, because some
// of the apps are in private repos and GitHub limits anonymous checks. docs/design/the-suite.md has the reasoning, and
// docs/app-suite.md in the rt-markdown-reader repo ("Updates and compatibility") has the plan.
//
//   { "apps": { "rt-markdown-reader": { "version": "3.11.0", "released": "2026-11-18", "url": "https://recontowers.com/apps/rt-markdown-reader/" } } }
//
// The rules, which the tests check with a fake fetch:
//   - It's read only when asked for: when the app starts and when the Apps panel opens or is refreshed. Never on a timer.
//   - The answer is kept for a day. A failure is kept for an hour, so a computer that's offline isn't asked again at every click.
//   - The request is a plain GET of the address with nothing added: no query string, no ids, no list of what's installed, no
//     cookies and no headers of ours. The address is the only thing about this app that is sent, and it's the same for everybody.
//   - If the file isn't there yet (the site hasn't published it) that's "not available" and nothing is said. If it can't be reached
//     the panel says "Couldn't check for updates" and carries on. Neither stops anything.
//   - Whatever comes back is untrusted: it's size-limited, and only a version number and an https address on our own site are kept.
const fs = require('node:fs');
const path = require('node:path');
const { isNewer, validVersion } = require('../shared/suite-apps');

// The one place the address lives, so it can change without touching anything else.
const VERSIONS_URL = 'https://recontowers.com/apps/versions.json';
const SITE = 'recontowers.com';
const DAY_MS = 24 * 60 * 60 * 1000;
const FAILED_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 64 * 1024;
const MAX_APPS = 64;

const idOk = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);

function pageOk(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && (url.hostname === SITE || url.hostname.endsWith(`.${SITE}`)) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

// Only what's wanted is kept, whatever else the file says.
function readFile(data) {
  const apps = {};
  const list = data && typeof data === 'object' && data.apps && typeof data.apps === 'object' ? Object.entries(data.apps) : [];
  for (const [id, entry] of list.slice(0, MAX_APPS)) {
    if (!idOk(id) || !entry || typeof entry !== 'object' || !validVersion(entry.version)) continue;
    const url = pageOk(entry.url);
    apps[id] = { version: entry.version, ...(url ? { url } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(entry.released) ? { released: entry.released } : {}) };
  }
  return apps;
}

// The plain request. Nothing is added to it: it's a GET of the address, with no cookies, no referrer and no headers of ours.
async function plainFetch(fetchIt, url) {
  const response = await fetchIt(url, { method: 'GET', redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 404 || response.status === 410) return { state: 'unavailable' };
  if (!response.ok) return { state: 'unreachable' };
  const text = await response.text();
  if (text.length > MAX_BYTES) return { state: 'unavailable' };
  try {
    return { state: 'ok', apps: readFile(JSON.parse(text)) };
  } catch {
    return { state: 'unavailable' };
  }
}

class Versions {
  // fetchIt is a fetch. file, if given, keeps the answer between runs, since "a day" should survive the app being closed. It holds
  // only what the site said, which is the same for everybody.
  constructor({ fetchIt = (...args) => globalThis.fetch(...args), url = VERSIONS_URL, now = () => Date.now(), file = null } = {}) {
    Object.assign(this, { fetchIt, url, now, file });
    this.answer = null;
    this.waiting = null;
  }

  load() {
    if (!this.file) return null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof saved.at !== 'number' || !['ok', 'unavailable', 'unreachable'].includes(saved.state)) return null;
      return { at: saved.at, state: saved.state, apps: saved.state === 'ok' ? readFile({ apps: saved.apps }) : {} };
    } catch {
      return null;
    }
  }

  save(answer) {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(answer));
    } catch {
      // Not being able to remember it only means it's asked again.
    }
  }

  fresh(answer) {
    return answer && this.now() - answer.at < (answer.state === 'unreachable' ? FAILED_MS : DAY_MS) && this.now() >= answer.at;
  }

  // { state: 'ok' | 'unavailable' | 'unreachable', apps }. `force` is for Refresh, which is the person asking again.
  async check({ force = false } = {}) {
    this.answer ??= this.load();
    if (!force && this.fresh(this.answer)) return this.answer;
    this.waiting ??= (async () => {
      let result;
      try {
        result = await plainFetch(this.fetchIt, this.url);
      } catch {
        result = { state: 'unreachable' };
      }
      this.answer = { at: this.now(), state: result.state, apps: result.apps ?? {} };
      this.save(this.answer);
      return this.answer;
    })().finally(() => { this.waiting = null; });
    return this.waiting;
  }
}

module.exports = { DAY_MS, FAILED_MS, VERSIONS_URL, Versions, isNewer, readFile };
