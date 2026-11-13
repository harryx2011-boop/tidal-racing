// Keyboard and gamepad, merged into one control state per frame.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered actions since the last poll
    this.steer = 0;
    this.padPrev = [];
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        const a = { KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyP: 'pause', KeyM: 'mute', Enter: 'confirm' }[e.code];
        if (a) this.pressed.add(a);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  poll(dt) {
    const k = this.keys;
    let throttle = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const want = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    // keys are on/off: ease the wheel over so a tap is a nudge, not a lurch
    const rate = want === 0 ? 5 : 3.2;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, want - this.steer));
    let steer = this.steer;
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('Space');

    const pad = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find((p) => p && p.connected);
    if (pad) {
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const pt = b(7) - b(6);
      if (Math.abs(pt) > 0.03) throttle = pt;
      const ps = dz(pad.axes[0] || 0);
      if (ps !== 0) steer = Math.sign(ps) * ps * ps;
      boost = boost || b(0) > 0.5 || b(5) > 0.5;
      const edges = { 3: 'camera', 2: 'reset', 9: 'pause', 0: 'confirm' };
      for (const i in edges) {
        const down = b(i) > 0.5;
        if (down && !this.padPrev[i]) this.pressed.add(edges[i]);
        this.padPrev[i] = down;
      }
    }
    const pressed = this.pressed;
    this.pressed = new Set();
    return { throttle, steer, boost, pressed };
  }
}
