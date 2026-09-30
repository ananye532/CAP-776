// Builds JAMS into Vercel's Build Output API layout (.vercel/output):
//   static/            the built React app
//   functions/api.func the Express API bundled into one ESM file + SQL migrations
// Docs: https://vercel.com/docs/build-output-api
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel/output');
const fn = path.join(out, 'functions/api.func');

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

cpSync(path.join(root, 'web/dist'), path.join(out, 'static'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'server/src/vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  external: ['pg-native'],
  // CommonJS dependencies inside an ESM bundle need require/__dirname.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __f } from 'node:url'; import { dirname as __d } from 'node:path'; const require = __cr(import.meta.url); const __filename = __f(import.meta.url); const __dirname = __d(__filename);",
  },
});

cpSync(path.join(root, 'server/drizzle'), path.join(fn, 'drizzle'), { recursive: true });
writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);

writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api(?:/.*)?$', dest: '/api' },
        {
          src: '^/assets/(.*)$',
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('Vercel build output written to', path.relative(process.cwd(), out));
