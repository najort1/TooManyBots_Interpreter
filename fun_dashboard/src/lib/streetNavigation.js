const EPSILON = 1e-6;

export function yawToPoint(from, to) {
  return Math.atan2(Number(to.x) - Number(from.x), Number(to.z) - Number(from.z));
}

export function dampAngle(current, target, lambda, delta) {
  const tau = Math.PI * 2;
  const difference = ((target - current + Math.PI) % tau + tau) % tau - Math.PI;
  return current + difference * (1 - Math.exp(-lambda * delta));
}

export function resolveStreetPosition(point, obstacles, radius = 0.48) {
  const result = { x: Number(point.x), z: Number(point.z) };
  for (let pass = 0; pass < 2; pass += 1) {
    for (const obstacle of obstacles) {
      if (obstacle.kind === "circle") {
        const dx = result.x - obstacle.x;
        const dz = result.z - obstacle.z;
        const minimum = obstacle.radius + radius;
        const distance = Math.hypot(dx, dz);
        if (distance < minimum) {
          const scale = minimum / Math.max(distance, EPSILON);
          result.x = obstacle.x + (distance < EPSILON ? minimum : dx * scale);
          result.z = obstacle.z + (distance < EPSILON ? 0 : dz * scale);
        }
        continue;
      }

      const minX = obstacle.x - obstacle.width / 2 - radius;
      const maxX = obstacle.x + obstacle.width / 2 + radius;
      const minZ = obstacle.z - obstacle.depth / 2 - radius;
      const maxZ = obstacle.z + obstacle.depth / 2 + radius;
      if (result.x <= minX || result.x >= maxX || result.z <= minZ || result.z >= maxZ) continue;

      const distances = [
        { value: Math.abs(result.x - minX), axis: "x", next: minX },
        { value: Math.abs(maxX - result.x), axis: "x", next: maxX },
        { value: Math.abs(result.z - minZ), axis: "z", next: minZ },
        { value: Math.abs(maxZ - result.z), axis: "z", next: maxZ },
      ].sort((a, b) => a.value - b.value);
      result[distances[0].axis] = distances[0].next;
    }
  }
  return result;
}
