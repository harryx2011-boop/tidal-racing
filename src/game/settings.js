// Player settings: persistence in localStorage and the choices the game reads every frame.
// Nothing here touches the DOM or the GL; hud.js draws the panel, main.js applies the values.
const KEY = 'tidal.settings';

export const TIERS = ['low', 'medium', 'high'];

const srgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
// Accent colours (sRGB hex here, linear in game.livery). Chosen to stay saturated against both
// the blue-grey sea and a white hull.
export const SWATCHES = [
  ['Orange', 0xff6a1a], ['Red', 0xe0242c], ['Yellow', 0xffc61a], ['Lime', 0x7cd22b],
  ['Teal', 0x14b8a6], ['Blue', 0x1f6feb], ['Violet', 0x8a4bff], ['Magenta', 0xe83e8c],
].map(([name, hex]) => ({ name, hex, color: srgb(hex) }));

export const STRIPES = ['Plain', 'Stripe 1', 'Stripe 2', 'Stripe 3'];

const DEFAULTS = {
  quality: null,        // null: the default tier for this build; a tier applies after a reload
  volume: 0.9,
  engineVol: 0.8, sfxVol: 0.8,   // engine and effects (race cues, water) volumes, under the master volume
  muted: false,
  speedFx: true,        // camera shake and radial blur
  auto: true,           // the frame-rate governor owns the effect levels and the render scale
  fx: { spray: 1, waterShadow: 1, shadows: 1 },   // manual levels, used when auto is off
  swatch: 0, stripe: 0, number: 7,
};

const clamp = (v, a, b, d) => (v !== null && v !== '' && Number.isFinite(+v) ? Math.min(Math.max(+v, a), b) : d);

export class Settings {
  constructor(storage) {
    this.storage = storage;
    this.listeners = [];
    this.active = 'medium';   // the tier this page was built with (set by main.js)
    Object.assign(this, JSON.parse(JSON.stringify(DEFAULTS)));
    let raw = null;
    try { raw = JSON.parse(storage?.getItem(KEY)); } catch { /* none or corrupt: defaults */ }
    if (raw && typeof raw === 'object') this.merge(raw);
  }

  // validate every field: a stored file from an older version or edited by hand must not break startup
  merge(r) {
    if (TIERS.includes(r.quality)) this.quality = r.quality;
    if ('volume' in r) this.volume = clamp(r.volume, 0, 1, DEFAULTS.volume);
    if ('engineVol' in r) this.engineVol = clamp(r.engineVol, 0, 1, DEFAULTS.engineVol);
    if ('sfxVol' in r) this.sfxVol = clamp(r.sfxVol, 0, 1, DEFAULTS.sfxVol);
    if ('muted' in r) this.muted = !!r.muted;
    if ('speedFx' in r) this.speedFx = !!r.speedFx;
    if ('auto' in r) this.auto = !!r.auto;
    if (r.fx && typeof r.fx === 'object') for (const k in DEFAULTS.fx) if (k in r.fx) this.fx[k] = clamp(r.fx[k], 0, 1, 1);
    if ('swatch' in r) this.swatch = Math.round(clamp(r.swatch, 0, SWATCHES.length - 1, 0));
    if ('stripe' in r) this.stripe = Math.round(clamp(r.stripe, 0, STRIPES.length - 1, 0));
    if ('number' in r) this.number = Math.round(clamp(r.number, 0, 99, 7));
  }

  // the tier to build: ?q= wins over the saved choice, which wins over the default
  tier(urlTier, fallback) { return TIERS.includes(urlTier) ? urlTier : this.quality || fallback; }

  livery() { return { color: SWATCHES[this.swatch].color.slice(), stripe: this.stripe, number: this.number }; }

  update(patch) {
    this.merge(patch);
    this.save();
    for (const f of this.listeners) f(this, patch);
  }

  save() {
    const { quality, volume, engineVol, sfxVol, muted, speedFx, auto, fx, swatch, stripe, number } = this;
    try { this.storage?.setItem(KEY, JSON.stringify({ quality, volume, engineVol, sfxVol, muted, speedFx, auto, fx, swatch, stripe, number })); } catch { /* blocked or full: lasts this session */ }
  }

  onChange(f) { this.listeners.push(f); }
}

let storage = null;
try { storage = window.localStorage; } catch { /* blocked */ }
export const settings = new Settings(storage);
