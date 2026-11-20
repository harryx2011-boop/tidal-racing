// Shared by the browser tools: finds Playwright and chooses between the real GPU and software GL.
//   GPU=1  real GPU (the default everywhere except Linux, where the build container has none)
//   GPU=0  software GL (swiftshader): slow, but the same picture on any machine
//   HEADED=1  show the browser window (real GPU only)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

export async function loadPlaywright() {
  const roots = [new URL('..', import.meta.url).href, 'file:///usr/lib/node_modules/'];
  try { roots.push('file:///' + execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().replace(/\\/g, '/') + '/'); } catch { /* no npm: the first two will do */ }
  for (const root of roots) {
    try { return createRequire(root)('playwright'); } catch { /* try the next place */ }
  }
  throw new Error('Playwright not found: npm i -g playwright && npx playwright install chromium');
}

export const realGpu = process.env.GPU ? process.env.GPU === '1' : process.platform !== 'linux';

// The full Chromium build in its new headless mode keeps the GPU process; the headless shell does not.
export function launchOptions(extraArgs = []) {
  if (!realGpu) return { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...extraArgs] };
  return { channel: 'chromium', headless: !process.env.HEADED, args: ['--ignore-gpu-blocklist', '--enable-gpu', ...extraArgs] };
}

export async function launch(extraArgs) {
  const { chromium } = await loadPlaywright();
  return chromium.launch(launchOptions(extraArgs));
}
