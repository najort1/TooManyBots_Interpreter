export const HOUSE_VOICE_SPATIAL = Object.freeze({
  // Coordenadas do multiplayer usam a faixa normalizada de 0 a 100.
  nearDistance: 4,
  maxDistance: 32,
  pannerReferenceDistance: 4,
  pannerRolloffFactor: 0.65,
});

function coordinate(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function getHouseVoiceSpatialPosition(listener, speaker) {
  const dx = coordinate(speaker?.x, 50) - coordinate(listener?.x, 50);
  const dz = coordinate(speaker?.y, 54) - coordinate(listener?.y, 54);
  const distance = Math.hypot(dx, dz);
  const { nearDistance, maxDistance } = HOUSE_VOICE_SPATIAL;

  if (distance >= maxDistance) {
    return { x: dx, y: 0, z: dz, distance, gain: 0 };
  }

  if (distance <= nearDistance) {
    return { x: dx, y: 0, z: dz, distance, gain: 1 };
  }

  const rangeProgress = (distance - nearDistance) / (maxDistance - nearDistance);
  return {
    x: dx,
    y: 0,
    z: dz,
    distance,
    gain: (1 - rangeProgress) ** 0.8,
  };
}
