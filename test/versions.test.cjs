'use strict';
// "What's the latest version of each app?", from one small file on our own site, through a fake fetch. Nothing here touches the
// network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DAY_MS, FAILED_MS, VERSIONS_URL, Versions } = require('../src/main/versions');

const FILE = {
  apps: {
    'rt-markdown-reader': { version: '3.11.0', released: '2026-11-18', url: 'https://recontowers.com/apps/rt-markdown-reader/' },
    'rt-press': { version: '1.0.0', url: 'https://recontowers.com/apps/rt-press/' },
  },
};

function fakeFetch(respond) {
  const calls = [];
  const fetchIt = async (url, options) => {
    calls.push({ url, options });
    return respond(calls.length);
  };
  return { fetchIt, calls };
}

const ok = (body) => ({ ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const status = (code) => ({ ok: false, status: code, text: async () => '' });

function clock(start = 1_000_000) {
  const time = { at: start };
  return { now: () => time.at, move: (ms) => { time.at += ms; } };
}

test('the address is the one the plan names, and the file is read into plain versions', async () => {
  assert.equal(VERSIONS_URL, 'https://recontowers.com/apps/versions.json');
  const { fetchIt } = fakeFetch(() => ok(FILE));
  const answer = await new Versions({ fetchIt }).check();
  assert.equal(answer.state, 'ok');
  assert.deepEqual(answer.apps['rt-markdown-reader'], { version: '3.11.0', url: 'https://recontowers.com/apps/rt-markdown-reader/', released: '2026-11-18' });
  assert.deepEqual(answer.apps['rt-press'], { version: '1.0.0', url: 'https://recontowers.com/apps/rt-press/' });
});

test('the request is a plain GET of the address and carries nothing about the person', async () => {
  const { fetchIt, calls } = fakeFetch(() => ok(FILE));
  await new Versions({ fetchIt }).check();
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, 'https://recontowers.com/apps/versions.json');
  assert.equal(new URL(url).search, '', 'no query string');
  assert.equal(new URL(url).hash, '');
  assert.equal(options.method, 'GET');
  assert.equal('headers' in options, false, 'no headers of ours');
  assert.equal('body' in options, false);
  assert.equal(options.credentials, 'omit', 'no cookies');
  assert.equal(options.referrerPolicy, 'no-referrer');
  const everything = JSON.stringify({ url, options: { ...options, signal: undefined } });
  for (const private_ of [os.hostname(), os.userInfo().username, os.homedir(), 'rt-story-tracker', 'rt-press', 'installed', 'version=']) {
    assert.equal(everything.includes(private_), false, `${private_} isn’t in the request`);
  }
});

test('the answer is kept for a day, and read again after it', async () => {
  const time = clock();
  const { fetchIt, calls } = fakeFetch(() => ok(FILE));
  const versions = new Versions({ fetchIt, now: time.now });
  await versions.check();
  await versions.check();
  time.move(DAY_MS - 60_000);
  await versions.check();
  assert.equal(calls.length, 1, 'opening the panel again within the day asks nothing');
  time.move(120_000);
  await versions.check();
  assert.equal(calls.length, 2, 'after a day it’s asked again');
  await versions.check({ force: true });
  assert.equal(calls.length, 3, 'Refresh is the person asking again');
});

test('at the same moment, one request is made, not several', async () => {
  const { fetchIt, calls } = fakeFetch(() => ok(FILE));
  const versions = new Versions({ fetchIt });
  await Promise.all([versions.check(), versions.check(), versions.check()]);
  assert.equal(calls.length, 1);
});

test('the answer is kept between runs, so closing the app doesn’t ask again', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-versions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'versions-cache.json');
  const time = clock();
  const first = fakeFetch(() => ok(FILE));
  await new Versions({ fetchIt: first.fetchIt, now: time.now, file }).check();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).apps['rt-press'].version, '1.0.0');
  assert.equal(fs.readFileSync(file, 'utf8').includes(os.userInfo().username), false, 'only what the site said is kept');
  time.move(60 * 60 * 1000);
  const second = fakeFetch(() => ok(FILE));
  const answer = await new Versions({ fetchIt: second.fetchIt, now: time.now, file }).check();
  assert.equal(second.calls.length, 0);
  assert.equal(answer.apps['rt-press'].version, '1.0.0');
  fs.writeFileSync(file, '{ not json');
  const third = fakeFetch(() => ok(FILE));
  await new Versions({ fetchIt: third.fetchIt, now: time.now, file }).check();
  assert.equal(third.calls.length, 1, 'a spoiled file is just asked for again');
});

test('a file that can’t be reached is "unreachable", for an hour, and carries on', async () => {
  const time = clock();
  const down = fakeFetch(() => { throw new Error('offline'); });
  const versions = new Versions({ fetchIt: down.fetchIt, now: time.now });
  assert.deepEqual(await versions.check(), { at: time.now(), state: 'unreachable', apps: {} });
  await versions.check();
  assert.equal(down.calls.length, 1, 'not asked again at every click');
  time.move(FAILED_MS + 1000);
  await versions.check();
  assert.equal(down.calls.length, 2);
  for (const code of [500, 503, 403]) {
    assert.equal((await new Versions({ fetchIt: fakeFetch(() => status(code)).fetchIt }).check()).state, 'unreachable', `HTTP ${code}`);
  }
  const slow = fakeFetch(() => new Promise((_, reject) => { setTimeout(() => reject(new Error('aborted')), 5); }));
  assert.equal((await new Versions({ fetchIt: slow.fetchIt }).check()).state, 'unreachable');
});

test('a file the site hasn’t published yet is "unavailable", which says nothing', async () => {
  for (const code of [404, 410]) {
    const answer = await new Versions({ fetchIt: fakeFetch(() => status(code)).fetchIt }).check();
    assert.equal(answer.state, 'unavailable');
    assert.deepEqual(answer.apps, {});
  }
  assert.equal((await new Versions({ fetchIt: fakeFetch(() => ok('<html>not json</html>')).fetchIt }).check()).state, 'unavailable');
  assert.equal((await new Versions({ fetchIt: fakeFetch(() => ok('x'.repeat(70 * 1024))).fetchIt }).check()).state, 'unavailable');
});

test('what comes back is untrusted: only a version and an https page on our own site are kept', async () => {
  const hostile = {
    apps: {
      'rt-press': { version: '2.0.0', url: 'https://evil.example/rt-press/' },
      'rt-audio-studio': { version: '1.0.0', url: 'javascript:alert(1)' },
      'rt-author-desk': { version: 'latest', url: 'https://recontowers.com/apps/rt-author-desk/' },
      '../x': { version: '9.9.9' },
      'recon-browser': { version: '1.3.0', url: 'https://user:pass@recontowers.com/', released: 'yesterday', extra: 'ignored' },
      'rt-markdown-reader': { version: '3.11.0', url: 'http://recontowers.com/plain' },
      'rt-story-tracker': { version: '3.8.0', url: 'https://www.recontowers.com/apps/rt-story-tracker/' },
    },
  };
  const { apps } = await new Versions({ fetchIt: fakeFetch(() => ok(hostile)).fetchIt }).check();
  assert.deepEqual(Object.keys(apps).sort(), ['recon-browser', 'rt-audio-studio', 'rt-markdown-reader', 'rt-press', 'rt-story-tracker']);
  assert.deepEqual(apps['rt-press'], { version: '2.0.0' }, 'an address on another site is dropped, the version stays');
  assert.deepEqual(apps['rt-audio-studio'], { version: '1.0.0' });
  assert.deepEqual(apps['recon-browser'], { version: '1.3.0' });
  assert.deepEqual(apps['rt-markdown-reader'], { version: '3.11.0' }, 'a plain http address is dropped');
  assert.equal(apps['rt-story-tracker'].url, 'https://www.recontowers.com/apps/rt-story-tracker/');
  const many = { apps: Object.fromEntries(Array.from({ length: 200 }, (_, at) => [`app-${at}`, { version: '1.0.0' }])) };
  assert.equal(Object.keys((await new Versions({ fetchIt: fakeFetch(() => ok(many)).fetchIt }).check()).apps).length, 64);
});
