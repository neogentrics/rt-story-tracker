'use strict';
// Proves that the speech engine works in whatever build is running, installed or not, without the 400 MB voice model. It starts the
// real voice process and hands it four models that do nothing, made here. To say it's ready, the process has to have loaded ONNX
// Runtime and its WebAssembly files from inside the app, and opened all four. It makes no sound: only a real model can.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ONNX files are Protocol Buffers. This writes the few parts the smallest model needs: one step that passes its input through.
function varint(value) {
  const out = [];
  let rest = value;
  do {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    out.push(rest ? byte + 128 : byte);
  } while (rest);
  return Buffer.from(out);
}
const number = (field, value) => Buffer.concat([varint(field * 8), varint(value)]);
const bytes = (field, value) => Buffer.concat([varint(field * 8 + 2), varint(value.length), Buffer.from(value)]);
const message = (...parts) => Buffer.concat(parts);

function smallestModel() {
  const FLOAT = 1;
  const shape = message(bytes(1, message(number(1, 1))));
  const type = message(bytes(1, message(number(1, FLOAT), bytes(2, shape))));
  const value = (name) => message(bytes(1, name), bytes(2, type));
  const node = message(bytes(1, 'x'), bytes(2, 'y'), bytes(4, 'Identity'));
  const graph = message(bytes(1, node), bytes(2, 'nothing'), bytes(11, value('x')), bytes(12, value('y')));
  const opset = message(bytes(1, ''), number(2, 13));
  return message(number(1, 8), bytes(7, graph), bytes(8, opset));
}

// A folder laid out as the downloaded voices are, as far as starting the engine reads it.
function standInModel(dir) {
  fs.mkdirSync(path.join(dir, 'onnx'), { recursive: true });
  for (const name of ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']) {
    fs.writeFileSync(path.join(dir, 'onnx', `${name}.onnx`), smallestModel());
  }
  fs.writeFileSync(path.join(dir, 'onnx', 'tts.json'), JSON.stringify({ ae: { sample_rate: 44100, base_chunk_size: 512 }, ttl: { chunk_compress_factor: 6, latent_dim: 24 } }));
  fs.writeFileSync(path.join(dir, 'onnx', 'unicode_indexer.json'), '[]');
}

// Resolves to 'ready', or to what went wrong.
function checkEngine({ fork, worker, timeout = 60000 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtst-voice-check-'));
  standInModel(dir);
  return new Promise((resolve) => {
    let child = null;
    const done = (answer) => {
      clearTimeout(timer);
      try {
        child?.kill();
      } catch {
        // Already gone.
      }
      child = null;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      resolve(answer);
    };
    const timer = setTimeout(() => done('the voice process didn’t answer'), timeout);
    try {
      child = fork(worker);
      child.on('message', (reply) => {
        if (reply.type === 'ready') done('ready');
        else if (reply.type === 'failed') done(`the engine failed: ${reply.error}`);
      });
      child.on('exit', (code) => {
        if (child) done(`the voice process stopped (${code})`);
      });
      child.postMessage({ type: 'init', dir, fake: false });
    } catch (error) {
      done(`the voice process couldn’t start: ${error.message}`);
    }
  });
}

module.exports = { checkEngine, smallestModel, standInModel };
