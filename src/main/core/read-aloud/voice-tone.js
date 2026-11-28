'use strict';
// Natural voices: shaping how they sound. Pure functions on sample arrays and voice-style data, so they run
// anywhere (the page, the worker, the tests) and need nothing downloaded.
//
//  - warm()         a gentle tone filter after speaking: a little more body, a softer top, light smoothing.
//  - mixStyles()    a new voice made by blending the style data of voices the model already ships.
//  - matchLoudness() the same loudness before and after, so a filtered clip isn't "better" just by being louder.
//  - trimSilence()  the quiet the model leaves before and after every sentence, cut to what a reader wants.
//  - the reading settings (3.12): pace, quality, warmth and breathing, and how a slow computer steps down.

// ---------------------------------------------------------------------------- tone

/** A biquad filter (R. Bristow-Johnson's audio EQ cookbook). type: 'lowshelf' | 'highshelf' | 'peak'. */
function biquad(type, rate, freq, gainDb, q = 0.707) {
  const A = 10 ** (gainDb / 40);
  const w = (2 * Math.PI * freq) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const beta = 2 * Math.sqrt(A) * alpha;
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowshelf') {
    b0 = A * ((A + 1) - (A - 1) * cos + beta); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - beta);
    a0 = (A + 1) + (A - 1) * cos + beta; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - beta;
  } else if (type === 'highshelf') {
    b0 = A * ((A + 1) + (A - 1) * cos + beta); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - beta);
    a0 = (A + 1) - (A - 1) * cos + beta; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - beta;
  } else {
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function filter(samples, c) {
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}

/** Gentle compression: quiet and loud words end up closer together. Soft knee, smooth attack and release. */
function smooth(samples, rate, { thresholdDb = -24, ratio = 2, attackMs = 8, releaseMs = 120 } = {}) {
  const out = new Float32Array(samples.length);
  const attack = Math.exp(-1 / ((attackMs / 1000) * rate));
  const release = Math.exp(-1 / ((releaseMs / 1000) * rate));
  let env = 0;
  for (let i = 0; i < samples.length; i++) {
    const level = Math.abs(samples[i]);
    env = level > env ? attack * env + (1 - attack) * level : release * env + (1 - release) * level;
    const db = 20 * Math.log10(Math.max(env, 1e-6));
    const over = db - thresholdDb;
    const reduction = over <= 0 ? 0 : over * (1 - 1 / ratio);
    out[i] = samples[i] * 10 ** (-reduction / 20);
  }
  return out;
}

const rms = (s) => { let t = 0; for (let i = 0; i < s.length; i++) t += s[i] * s[i]; return Math.sqrt(t / Math.max(1, s.length)); };
const peak = (s) => { let p = 0; for (let i = 0; i < s.length; i++) p = Math.max(p, Math.abs(s[i])); return p; };

/** Scale to a loudness (RMS, 0..1), never letting the loudest point pass `ceiling`. */
function matchLoudness(samples, target = 0.1, ceiling = 0.95) {
  const r = rms(samples);
  if (!r) return samples;
  const gain = Math.min(target / r, ceiling / Math.max(peak(samples), 1e-9));
  return samples.map((v) => v * gain);
}

/**
 * Make a voice sound warmer. `amount` runs from 0 (untouched) to 1 (clearly warm); about 0.5 is a gentle default.
 * More body in the low voice, a little presence so it isn't muffled, a softer top, and light smoothing.
 * Loudness stays what it was.
 */
function warm(samples, rate, amount = 0.5) {
  if (!(amount > 0) || !samples.length) return samples;
  const a = Math.min(1.5, amount);
  const before = rms(samples);
  let s = filter(samples, biquad('lowshelf', rate, 200, 3.5 * a));
  s = filter(s, biquad('peak', rate, 450, 1.5 * a, 0.8));
  s = filter(s, biquad('peak', rate, 3200, 1.0 * a, 0.9));
  s = filter(s, biquad('highshelf', rate, 7000, -3.5 * a));
  s = smooth(s, rate, { ratio: 1 + 1.2 * a });
  return matchLoudness(s, before);
}

// ---------------------------------------------------------------------------- silence

/**
 * The model leaves about 0.4 s of digital silence before every sentence and 0.3 s after, so sentences
 * arrived with a gap of about 0.7 s, and the first sentence of a reading, split in two to start sooner,
 * had the same hole in the middle. Keep `head` seconds before the first sound and `tail` after the last,
 * and never add any: a clip with less silence than that is returned as it is.
 */
function trimSilence(samples, rate, head = 0.1, tail = 0.3, floor = 0.004) {
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < floor) first++;
  if (first === samples.length) return samples;                       // all quiet: nothing to anchor to
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) < floor) last--;
  const from = Math.max(0, first - Math.round(head * rate));
  const to = Math.min(samples.length, last + 1 + Math.round(tail * rate));
  return from === 0 && to === samples.length ? samples : samples.slice(from, to);
}

// ---------------------------------------------------------------------------- reading settings (3.12)

/** Quality is how many refinement steps a sentence gets. Measured: each step costs about 0.1 s per second of speech. */
const QUALITY = { faster: 8, balanced: 12, best: 16 };
const QUICK_STEPS = 5;                                                // speech someone is waiting for, and the floor on a slow computer
const LEVELS = [QUICK_STEPS, QUALITY.faster, QUALITY.balanced, QUALITY.best];
const PACES = [0.95, 1.05, 1.15, 1.25, 1.35];                         // the model's own speed, as heard in the samples
const WARMTHS = [0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2];                // 0 is off
const BREATHING = ['off', 'reading', 'paragraphs'];
const DEFAULT_READING = { pace: 1.15, quality: 'balanced', warmth: 1.05, breathing: 'off' };

/** A saved reading preference, made safe: anything unknown becomes the default. */
function cleanReading(input = {}) {
  const near = (list, v, fallback) => { const n = Number(v); return Number.isFinite(n) && list.includes(Math.round(n * 100) / 100) ? Math.round(n * 100) / 100 : fallback; };
  return {
    pace: near(PACES, input.pace, DEFAULT_READING.pace),
    quality: Object.hasOwn(QUALITY, input.quality) ? input.quality : DEFAULT_READING.quality,
    warmth: Number(input.warmth) === 0 ? 0 : near(WARMTHS, input.warmth, DEFAULT_READING.warmth),
    breathing: BREATHING.includes(input.breathing) ? input.breathing : DEFAULT_READING.breathing,
  };
}

/**
 * How many steps a computer can afford. `perStep` is how long one step took, in seconds of work per second of
 * speech (so 0.1 means a step costs a tenth of the speech's own length). Speech has to be made faster than it
 * plays, with room to spare, so the most steps allowed is the largest level that keeps the sentence under
 * `budget` times real time (0.7, as before). Never fewer than QUICK_STEPS, never more than `wanted`.
 */
function affordableSteps(wanted, perStep, budget = 0.7) {
  if (!(perStep > 0)) return wanted;
  const fits = LEVELS.filter((n) => n <= wanted && n * perStep <= budget);
  return fits.length ? Math.max(...fits) : QUICK_STEPS;
}

/**
 * Watches how long sentences take to make and says how many steps this computer can afford (see affordableSteps).
 * It goes by the middle of the last few sentences, so one slow one (the first, while the voice warms up, or a busy
 * moment) doesn't fix the choice for the whole reading, and a computer that turns out faster is let up again.
 */
function stepGovernor(keep = 5) {
  const seen = [];
  return {
    /** A sentence took `ms` to make for `secs` of speech, at `steps` steps. */
    note(ms, secs, steps) {
      if (!(ms > 0 && secs > 0 && steps > 0)) return;
      seen.push(ms / 1000 / secs / steps);
      if (seen.length > keep) seen.shift();
    },
    /** The most steps worth asking for, up to `wanted`. */
    cap(wanted) {
      if (!seen.length) return wanted;
      const sorted = [...seen].sort((a, b) => a - b);
      return affordableSteps(wanted, sorted[sorted.length >> 1]);
    },
    reset() { seen.length = 0; },
  };
}

// ---------------------------------------------------------------------------- voices

/**
 * Blend voice styles. `parts` is [[styleJson, weight], …]; the weights are used as given (they don't have to
 * add up to 1: a weight above 1 or below 0 pushes a voice further from, or past, the others). The result has
 * the same shape as a voice_styles/*.json file, so it goes wherever a voice file does.
 */
function mixStyles(parts) {
  if (!parts.length) throw new Error('Nothing to blend');
  const flat = (v) => Float32Array.from(v.data.flat(Infinity));
  const out = {};
  for (const key of ['style_ttl', 'style_dp']) {
    const first = parts[0][0][key];
    const data = new Float32Array(flat(first).length);
    for (const [json, weight] of parts) {
      const d = flat(json[key]);
      if (d.length !== data.length || json[key].dims.join() !== first.dims.join()) throw new Error('These voices don’t fit together');
      for (let i = 0; i < data.length; i++) data[i] += d[i] * weight;
    }
    out[key] = { ...first, data: Array.from(data) };
  }
  return out;
}

/** A repeatable stream of random numbers (so two clips can differ in one setting only). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { biquad, filter, smooth, rms, peak, matchLoudness, warm, mixStyles, seeded, trimSilence, QUALITY, QUICK_STEPS, LEVELS, PACES, WARMTHS, BREATHING, DEFAULT_READING, cleanReading, affordableSteps, stepGovernor };
