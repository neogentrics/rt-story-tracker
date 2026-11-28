// A project's pronunciation list: a word as it's written, and how read aloud should say it. Listen says the second one.
import { NATURAL, cleanPronunciations } from '../shared/reading.js';
import { el } from './dom.js';
import { ownVoices, play } from './read-aloud.js';

// Says some words in the voice chosen, or the best there is.
async function hear(api, text) {
  const [{ readAloud }, natural] = await Promise.all([api.settings(), api.voiceStatus()]);
  const own = ownVoices().find((voice) => voice.name === readAloud.voice);
  if (!own && natural.installed) {
    const id = readAloud.voice.startsWith(NATURAL) ? readAloud.voice.slice(NATURAL.length) : 'F1';
    const made = await api.voiceSpeak({ text, lang: 'en', voice: id, speed: readAloud.pace * readAloud.speed, steps: 8, warmth: readAloud.warmth });
    if (made.error) throw new Error(made.error);
    play(made.samples, made.sampleRate, readAloud.output);
    return;
  }
  const synth = window.readAloudStandIn?.synth ?? window.speechSynthesis;
  const voice = own ?? ownVoices().find((one) => one.default) ?? ownVoices()[0];
  if (!voice) throw new Error('There’s no voice on this computer to say it with.');
  const Utterance = window.readAloudStandIn?.Utterance ?? window.SpeechSynthesisUtterance;
  const utterance = new Utterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  synth.cancel();
  synth.speak(utterance);
}

export async function openPronunciations({ api, onError }) {
  document.getElementById('pronunciation')?.remove();
  const rows = el('ul', { class: 'pronunciation-rows' });
  const problem = el('p', { class: 'dialog-error', role: 'alert', hidden: true });
  const say = (message) => {
    problem.textContent = message;
    problem.hidden = !message;
  };

  const row = ({ word = '', say: spoken = '' } = {}) => {
    const written = el('input', { type: 'text', class: 'say-word', 'aria-label': 'Word as written', maxlength: '100', placeholder: 'As written' });
    const heard = el('input', { type: 'text', class: 'say-as', 'aria-label': 'How to say it', maxlength: '200', placeholder: 'How to say it' });
    written.value = word;
    heard.value = spoken;
    const line = el('li', {},
      written,
      heard,
      el('button', {
        type: 'button',
        'aria-label': 'Listen',
        class: 'say-listen',
        onclick: () => {
          say('');
          const text = heard.value.trim() || written.value.trim();
          if (text) hear(api, text).catch((error) => say(error.message));
        },
      }, 'Listen'),
      el('button', { type: 'button', class: 'quiet say-remove', 'aria-label': `Remove ${word || 'this word'}`, onclick: () => line.remove() }, 'Remove'));
    return line;
  };

  const list = await api.pronunciations();
  rows.append(...(list.length ? list : [{}]).map(row));

  const dialog = el('dialog', { id: 'pronunciation', class: 'dialog pronunciation-window', 'aria-label': 'Pronunciation list' },
    el('h2', {}, 'Pronunciation list'),
    el('p', { class: 'quiet-note' }, 'For this project. Write the second box the way the word sounds, for example “Siobhan” and “shiv-awn”. Whole words are matched, in any capitals. Your writing isn’t changed.'),
    rows,
    el('button', {
      type: 'button',
      id: 'say-add',
      onclick: () => {
        const added = row();
        rows.append(added);
        added.querySelector('input').focus();
      },
    }, 'Add a word'),
    problem,
    el('div', { class: 'dialog-actions' },
      el('button', { type: 'button', id: 'say-cancel', onclick: () => dialog.close() }, 'Cancel'),
      el('button', {
        type: 'button',
        id: 'say-save',
        class: 'primary',
        onclick: async () => {
          const wanted = [...rows.children].map((line) => ({ word: line.querySelector('.say-word').value, say: line.querySelector('.say-as').value }));
          try {
            await api.savePronunciations(cleanPronunciations(wanted));
            dialog.close();
          } catch (error) {
            say(error.message);
            onError?.(error.message);
          }
        },
      }, 'Save')));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
