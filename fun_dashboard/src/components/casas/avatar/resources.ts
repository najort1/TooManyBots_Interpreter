import * as THREE from "three";

const geometries = new Map<string, THREE.BufferGeometry>();
const materials = new Map<string, THREE.Material>();
const sharedGeometries = new WeakSet<THREE.BufferGeometry>();
const sharedMaterials = new WeakSet<THREE.Material>();

function normalizedNumber(value: number) {
  return Number(value.toFixed(5));
}

function geometryParametersKey(geometry: THREE.BufferGeometry) {
  try {
    const parameters = (geometry as THREE.BufferGeometry & { parameters?: unknown }).parameters;
    if (!parameters) return geometry.uuid;
    return JSON.stringify(parameters, (_key, value) => (
      typeof value === "number" ? normalizedNumber(value) : value
    ));
  } catch {
    return geometry.uuid;
  }
}

export function shareAvatarGeometry<T extends THREE.BufferGeometry>(geometry: T) {
  if (sharedGeometries.has(geometry)) return geometry;
  const key = `${geometry.type}:${geometryParametersKey(geometry)}`;
  const cached = geometries.get(key);
  if (cached) {
    geometry.dispose();
    return cached as T;
  }
  geometries.set(key, geometry);
  sharedGeometries.add(geometry);
  return geometry;
}

export function avatarBoxGeometry(size: readonly [number, number, number]) {
  const key = `BoxGeometry:${size.map(normalizedNumber).join(":")}`;
  const cached = geometries.get(key);
  if (cached) return cached as THREE.BoxGeometry;
  const geometry = new THREE.BoxGeometry(...size);
  geometries.set(key, geometry);
  sharedGeometries.add(geometry);
  return geometry;
}

export function avatarStandardMaterial(color: number, roughness = 0.72, metalness = 0.03, emissive?: number, emissiveIntensity = 0) {
  const key = `standard:${color}:${roughness}:${metalness}:${emissive ?? "none"}:${emissiveIntensity}`;
  const cached = materials.get(key);
  if (cached) return cached as THREE.MeshStandardMaterial;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    ...(emissive === undefined ? {} : { emissive, emissiveIntensity }),
  });
  materials.set(key, material);
  sharedMaterials.add(material);
  return material;
}

export function avatarShadowMaterial() {
  const key = "shadow:090810:0.3";
  const cached = materials.get(key);
  if (cached) return cached as THREE.MeshBasicMaterial;
  const material = new THREE.MeshBasicMaterial({ color: 0x090810, transparent: true, opacity: 0.3, depthWrite: false });
  materials.set(key, material);
  sharedMaterials.add(material);
  return material;
}

export function isSharedAvatarGeometry(value: THREE.BufferGeometry | undefined) {
  return Boolean(value && sharedGeometries.has(value));
}

export function isSharedAvatarMaterial(value: THREE.Material | undefined) {
  return Boolean(value && sharedMaterials.has(value));
}

export function disposeAvatarResourceRegistry() {
  geometries.forEach((geometry) => geometry.dispose());
  geometries.clear();
  materials.forEach((material) => material.dispose());
  materials.clear();
}
