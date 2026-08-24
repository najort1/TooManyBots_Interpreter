export function shouldPublishMovement({ moving, wasMoving, elapsed, lastSent, interval }) {
  if (moving !== wasMoving) return true;
  return moving && elapsed - lastSent >= interval;
}
