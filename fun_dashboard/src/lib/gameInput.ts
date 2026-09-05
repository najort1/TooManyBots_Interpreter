/** UI controls own the keyboard while focused; game shortcuts must not consume it. */
export function isGameInputBlocked(target: EventTarget | null, locked = false) {
  return locked || (target instanceof HTMLElement && Boolean(target.closest(
    'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]',
  )));
}

export const GAME_MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
