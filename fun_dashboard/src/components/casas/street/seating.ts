export type SeatFacing = "left" | "right";

export type StreetSeat = {
  id: string;
  label: string;
  x: number;
  y: number;
  facing: SeatFacing;
  hitRadius?: number;
};

export function nearestStreetSeat(seats: StreetSeat[], x: number, y: number) {
  let nearest: StreetSeat | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const seat of seats) {
    const distance = Math.hypot(seat.x - x, seat.y - y);
    if (distance <= (seat.hitRadius ?? 48) && distance < nearestDistance) {
      nearest = seat;
      nearestDistance = distance;
    }
  }

  return nearest;
}
