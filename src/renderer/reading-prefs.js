// Preferences, Reading Aloud: the voice and how it reads, the speakers it plays through, the natural voices' download, and the
// project's pronunciation list.
import { NATURAL, NATURAL_VOICES, SPEEDS } from '../shared/reading.js';
import { voiceLabel } from '../main/core/read-aloud/voice-text.js';
import { BREATHING, PACES, QUALITY, WARMTHS } from '../main/core/read-aloud/voice-tone.js';
import { el, fill } from './dom.js';
import { openPronunciations } from './pronunciation-dialog.js';
import { ownVoices } from './read-aloud.js';

const QUALITY_NAMES = { faster: 'Faster', balanced: 'Balanced', best: 'Best' };
const BREATHING_NAMES = { off: 'Off', reading: 'At the start and end of a reading', paragraphs: 'Before and after each paragraph' };
const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

function choice(id, options, value, onChange) {
  const control = el('select', { id, onchange: () => onChange(control.value) }, options.map(([key, label]) => el('option', { value: String(key) }, label)));
  control.value = String(value);
  return control;
}

const field = (label, control) => el('label', { class: 'field' }, el('span', {}, label), control);
const note = (text) => el('p', { class: 'quiet-note' }, text);

// `settings` is read and saved through `get` and `save`, which Preferences owns. Returns { body, shown }.
export function readingSection({ api, get, save, onError }) {
  const set = (name, value) => save({ [name]: value }).catch((error) => onError(error.message));
  const pane = el('div', { class: 'reading-pane' });

  async function draw() {
    const reading = get().readAloud;
    const voice = el('select', { id: 'pref-voice', onchange: () => set('voice', voice.value) });
    const output = el('select', { id: 'pref-output', onchange: () => set('output', output.value) });
    const natural = el('div', { id: 'pref-natural', role: 'status' });
    const words = el('div', {});

    const fillVoices = (status) => {
      fill(voice,
        el('option', { value: '' }, 'The best there is'),
        status.installed ? el('optgroup', { label: 'Natural voices' }, NATURAL_VOICES.map((id) => el('option', { value: NATURAL + id }, voiceLabel(id)))) : null,
        el('optgroup', { label: 'This computer’s voices' }, ownVoices().map((one) => el('option', { value: one.name }, one.name))));
      voice.value = get().readAloud.voice;
      if (voice.selectedIndex < 0) voice.value = '';
    };

    const fillNatural = (status) => {
      const action = (id, label, run) => el('button', {
        type: 'button',
        id,
        onclick: () => run().then(showNatural, (error) => onError(error.message)),
      }, label);
      if (status.downloading) {
        const share = Math.floor((100 * status.done) / (status.total || 1));
        fill(natural,
          el('p', {}, `Downloading the natural voices: ${share}% of ${megabytes(status.total)}.`),
          el('progress', { max: '100', value: String(share), 'aria-label': 'Download' }),
          action('pref-voice-stop', 'Stop the download', api.voiceCancelDownload));
      } else if (status.installed) {
        fill(natural, el('p', {}, 'The natural voices are on this computer and work offline.'), action('pref-voice-remove', 'Remove the natural voices…', api.voiceRemove));
      } else {
        fill(natural,
          el('p', {}, `Voices that sound like a person reading. About ${megabytes(status.total)}, downloaded once, only if you ask. After that they work offline.`),
          status.error ? el('p', { class: 'dialog-error' }, status.error) : null,
          action('pref-voice-get', status.error ? 'Try the download again…' : 'Get the natural voices…', api.voiceInstall));
      }
    };

    let last = '';
    function showNatural(status) {
      if (!pane.isConnected) return;
      fillNatural(status);
      // The list of voices only changes when the voices arrive or go.
      if (last !== String(status.installed)) {
        last = String(status.installed);
        fillVoices(status);
      }
    }

    // Speakers or headphones. The computer plays its own voices itself, so this is for the natural ones.
    const fillOutputs = async () => {
      const devices = (await navigator.mediaDevices?.enumerateDevices?.() ?? [])
        .filter((device) => device.kind === 'audiooutput' && !['default', 'communications'].includes(device.deviceId));
      fill(output, el('option', { value: '' }, 'The computer’s usual one'), devices.map((device, at) => el('option', { value: device.deviceId }, device.label || `Speakers or headphones ${at + 1}`)));
      output.value = get().readAloud.output;
      if (output.selectedIndex < 0) output.value = '';
    };

    const carryOn = el('input', { type: 'checkbox', id: 'pref-carry-on', checked: reading.carryOn, onchange: () => set('carryOn', carryOn.checked) });

    fill(pane,
      field('Voice', voice),
      field('Speed', choice('pref-speed', SPEEDS.map((value) => [value, `${value}×`]), reading.speed, (value) => set('speed', Number(value)))),
      el('label', { class: 'check' }, carryOn, 'Carry on into the next chapter'),
      el('h4', {}, 'Natural voices'),
      natural,
      field('Pace', choice('pref-pace', PACES.map((value) => [value, `${value}×`]), reading.pace, (value) => set('pace', Number(value)))),
      field('Quality', choice('pref-quality', Object.keys(QUALITY).map((key) => [key, QUALITY_NAMES[key]]), reading.quality, (value) => set('quality', value))),
      note('On a slower computer, reading aloud lowers the quality by itself, so that it doesn’t stop between sentences.'),
      field('Warmth', choice('pref-warmth', [[0, 'Off'], ...WARMTHS.map((value) => [value, value.toFixed(2)])], reading.warmth, (value) => set('warmth', Number(value)))),
      field('Breathing', choice('pref-breathing', BREATHING.map((key) => [key, BREATHING_NAMES[key]]), reading.breathing, (value) => set('breathing', value))),
      field('Play through', output),
      note('This is for the natural voices. Your computer plays its own voices through its usual speakers.'),
      el('h4', {}, 'Pronunciation'),
      note('Say how a name or an invented word sounds, and read aloud says it that way. Each project has its own list, kept inside it, so it’s encrypted with your writing.'),
      words);

    api.pronunciations().then(
      () => fill(words, el('button', { type: 'button', id: 'pref-pronunciation', onclick: () => openPronunciations({ api, onError }) }, 'Pronunciation list…')),
      () => fill(words, note('Open a project to see or change its list.')),
    );

    const status = await api.voiceStatus();
    showNatural(status);
    // One listener for as long as this window lives. It does nothing once the window has gone.
    current = showNatural;
    await fillOutputs();
  }

  return { body: () => [pane], shown: () => draw().catch((error) => onError(error.message)) };
}

let current = null;
export function listenForVoiceDownload(api) {
  api.onVoiceProgress((status) => current?.(status));
}
