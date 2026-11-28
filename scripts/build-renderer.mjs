// Bundles the window (screens, editor and styles) into dist/renderer, and the process that speaks into dist.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'renderer');

const dist = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
rmSync(join(dist, 'voice'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(join(dist, 'voice'), { recursive: true });
cpSync(join(root, 'src/renderer/index.html'), join(out, 'index.html'));
cpSync(join(root, 'build/icon.png'), join(out, 'icon.png'));

await build({
  entryPoints: {
    app: join(root, 'src/renderer/app.js'),
    style: join(root, 'src/renderer/style.css'),
    fonts: join(root, 'src/renderer/fonts.css'), // For print files, which load these by themselves.
  },
  outdir: out,
  bundle: true,
  format: 'iife', // file:// pages can't load ES modules, so this ships one classic script.
  platform: 'browser',
  target: ['chrome130'],
  minify: true,
  legalComments: 'linked',
  logLevel: 'warning',
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Export as audio: the MP3 encoder, LAME, is under the GNU LGPL. It stays a file of its own, exactly as published, that the window
// loads only to write an MP3, and that the installer leaves outside the app's archive so it can be replaced (THIRD_PARTY_NOTICES.md).
// lame.all.js is the same code before it was made small, so the encoder's source goes with it.
cpSync(join(root, 'node_modules/lamejs/lame.min.js'), join(out, 'lame.min.js'));
cpSync(join(root, 'node_modules/lamejs/lame.all.js'), join(out, 'lame.all.js'));

// Read aloud: the process that speaks (the shared engine, bundled with ONNX Runtime) and, beside it in voice/, ONNX Runtime's two
// WebAssembly files.
for (const file of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  cpSync(join(root, 'node_modules/onnxruntime-web/dist', file), join(dist, 'voice', file));
}
await build({
  entryPoints: { 'voice-worker': join(root, 'src/main/core/read-aloud/voice-worker.js') },
  outdir: dist,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node20'],
  minify: true,
  legalComments: 'linked',
  logLevel: 'warning',
});
