// What a pause press does (Esc, P, the gamepad's Start). While Settings is open on top of the pause plate the
// press closes Settings and brings the plate back, as Escape on the keyboard does (hud.js); it must never
// resume the race behind the panel. In the menu there is nothing to pause.
export function pauseAction({ state, settingsOpen }) {
  if (state === 'menu') return 'none';
  return settingsOpen ? 'closeSettings' : 'toggle';
}
