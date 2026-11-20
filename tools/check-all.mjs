// Everything that needs no browser, in one command:   node tools/check-all.mjs
//   1. the unit tests (node --test, every tests/**/*.test.mjs)
//   2. tools/check-land.mjs     courses against their land
//   3. tools/check-collide.mjs  a boat driven into every solid
//   4. tools/check-contact.mjs  (only once it exists)
// Exit status is non-zero if any step fails. The browser smoke test is separate (tools/smoke.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const find = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? find(p) : /\.test\.m?js$/.test(n) ? [p] : [];
});
const testFiles = existsSync(join(root, 'tests')) ? find(join(root, 'tests')).map((p) => relative(root, p)).sort() : [];

const steps = [
  ['unit tests', ['--test', ...testFiles]],
  ['check-land', ['tools/check-land.mjs']],
  ['check-collide', ['tools/check-collide.mjs']],
];
if (existsSync(join(root, 'tools/check-contact.mjs'))) steps.push(['check-contact', ['tools/check-contact.mjs']]);

const results = [];
for (const [name, args] of steps) {
  console.log(`\n=== ${name} ===`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  results.push([name, r.status === 0, Date.now() - t0]);
}
console.log('\n=== summary ===');
for (const [name, ok, ms] of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${(ms / 1000).toFixed(1)} s)`);
const bad = results.filter((r) => !r[1]).length;
console.log(bad ? `${bad} of ${results.length} steps failed` : `all ${results.length} steps passed`);
process.exit(bad ? 1 : 0);
