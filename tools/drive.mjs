// Dev tool: drive the game in headless Chromium and capture a screenshot.
//   node tools/serve.mjs 5173 &
//   node tools/drive.mjs out.png "q=low&scale=0.5" "await T.sim(30); app.game.start('circuit','breeze'); T.autopilot(); await T.sim(300, 1/30); await T.frames(8); return T.snap();" 960 540
// The page runs with ?manual (no animation loop): the script steps it. T.sim() advances the sea and
// the game without drawing (fast enough for physics runs under software GL); T.frames() renders.
// Set PAGE=1 to capture the whole page (with the HUD) instead of the canvas only.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/usr/lib/node_modules/');
let pw; try { pw = require('playwright'); } catch { pw = (await import('playwright')).default; }
const { chromium } = pw;
const [,, out, query = '', body = 'return null;', W = '640', H = '360'] = process.argv;
const HELPERS = "window.T = {\n  // sea + game only (no sky, clouds or drawing): cheap enough for long physics runs under software GL\n  async sim(n, dt = 1 / 60, each) {\n    const W = app.weather;\n    for (let i = 0; i < n; i++) {\n      if (each) each(i);\n      app.time += dt; W.update(dt);\n      const S = W.state;\n      app.ocean.lambda = Math.max(S.choppy, W.choppyFor(S.wind));\n      app.ocean.setSpectrum(W.spectrum());\n      app.ocean.update(app.time, dt, W.foam());\n      app.game.update(dt, app.ocean.textures());\n      app.gl.flush();\n      await new Promise((r) => setTimeout(r, 0));\n    }\n  },\n  async frames(n, dt = 1 / 60) { for (let i = 0; i < n; i++) { app.frame(dt); await new Promise((r) => setTimeout(r, 0)); } app.gl.finish(); },\n  key(code, down) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })); },\n  snap() { const g = app.game, b = g.boat; return { t: +app.time.toFixed(2), state: g.state, pos: b.pos.map((x) => +x.toFixed(2)), spd: +b.speed.toFixed(1), pitch: +b.pitch.toFixed(3), roll: +b.roll.toFixed(3), wet: b.wet, boost: +b.boost.toFixed(2), next: g.progress.next, fresh: g.probe.fresh, seaH: +g.probe.result[0].h.toFixed(2) }; },\n};\n// drive toward the next gate\nT.autopilot = (boost = false) => {\n  const g = app.game;\n  g.input.poll = () => {\n    const b = g.boat, q = g.progress.gate;\n    const tx = q.c[0] + q.dir[0] * 12 - b.pos[0], tz = q.c[1] + q.dir[1] * 12 - b.pos[2];\n    let d = (Math.atan2(tz, tx) - b.yaw) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;\n    return { throttle: Math.abs(d) > 0.9 ? 0.5 : 1, steer: Math.max(-1, Math.min(1, d * 2.5)), boost, pressed: new Set() };\n  };\n};\n";
const script = `(async () => { (0, eval)(${JSON.stringify(HELPERS)}); ${body} })()`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') process.stderr.write('[' + m.type() + '] ' + m.text().slice(0, 2500) + '\n'); });
page.on('pageerror', (e) => process.stderr.write('[pageerror] ' + e.message.slice(0, 3000) + '\n'));
try {
  await page.goto('http://localhost:' + (process.env.PORT || 5173) + '/?manual&preserve&' + query, { waitUntil: 'load' });
  await page.waitForFunction('window.app && window.app.game', null, { timeout: 60000 });
  const r = await page.evaluate(`(async () => { const t0 = performance.now(); const out = await (${script}); return { out, ms: Math.round(performance.now() - t0) }; })()`);
  process.stderr.write('eval: ' + JSON.stringify(r) + '\n');
  // the canvas itself (the page compositor is too slow under software GL), with the HUD drawn by the DOM skipped
  if (process.env.PAGE) { await page.screenshot({ path: out, timeout: 120000 }); await browser.close(); process.exit(0); }
  const url = await page.evaluate(`document.getElementById('c').toDataURL('image/png')`);
  writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
} catch (e) { process.stderr.write('FAIL ' + e.message.slice(0, 2000) + '\n'); }
await browser.close();
