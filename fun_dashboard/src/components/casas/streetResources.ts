import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createThreeResourceOwnershipRegistry } from "@/lib/threeResourceOwnership.js";
import { isSharedAvatarGeometry, isSharedAvatarMaterial } from "./avatar/resources";

type AssetEntry = { promise: Promise<THREE.Group>; model?: THREE.Group };

const loader = new GLTFLoader();
const assets = new Map<string, AssetEntry>();
const geometries = new Map<string, THREE.BoxGeometry>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
const assetMaterials = new Map<string, THREE.Material>();
const ownership = createThreeResourceOwnershipRegistry();
let registryGeneration = 0;

function disposeMaterial(material: THREE.Material) {
  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) value.dispose();
  });
  material.dispose();
}

function disposeModel(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const values = Array.isArray(object.material) ? object.material : [object.material];
    values.forEach(disposeMaterial);
  });
}

function textureKey(value: unknown) {
  if (!(value instanceof THREE.Texture)) return "none";
  const image = value.image as { currentSrc?: string; src?: string } | undefined;
  return image?.currentSrc || image?.src || value.name || value.uuid;
}

function materialKey(material: THREE.Material) {
  const candidate = material as THREE.MeshStandardMaterial;
  return [
    material.type,
    candidate.color?.getHexString?.() || "none",
    candidate.emissive?.getHexString?.() || "none",
    candidate.emissiveIntensity ?? 0,
    candidate.roughness ?? "none",
    candidate.metalness ?? "none",
    material.opacity,
    material.transparent ? 1 : 0,
    material.side,
    material.vertexColors ? 1 : 0,
    material.alphaTest,
    material.blending,
    material.depthWrite ? 1 : 0,
    textureKey(candidate.map),
    textureKey(candidate.normalMap),
    textureKey(candidate.roughnessMap),
    textureKey(candidate.metalnessMap),
    textureKey(candidate.emissiveMap),
    textureKey(candidate.alphaMap),
    textureKey(candidate.aoMap),
  ].join(":");
}

function canonicalAssetMaterial(material: THREE.Material) {
  const key = materialKey(material);
  const cached = assetMaterials.get(key);
  if (cached) {
    material.dispose();
    return cached;
  }
  assetMaterials.set(key, material);
  ownership.markMaterial(material);
  return material;
}

export function streetBoxGeometry(size: readonly [number, number, number]) {
  const key = size.join(":");
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = new THREE.BoxGeometry(...size);
    geometries.set(key, geometry);
    ownership.markGeometry(geometry);
  }
  return geometry;
}

export function streetStandardMaterial(color: number, roughness = 0.72, metalness = 0.04) {
  const key = `${color}:${roughness}:${metalness}`;
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.set(key, material);
    ownership.markMaterial(material);
  }
  return material;
}

export function loadStreetAsset(assetUrl: string) {
  const cached = assets.get(assetUrl);
  if (cached) return cached.promise;
  const entry: AssetEntry = { promise: Promise.resolve(new THREE.Group()) };
  const generation = registryGeneration;
  entry.promise = new Promise<THREE.Group>((resolve, reject) => {
    loader.load(assetUrl, ({ scene }) => {
      if (generation !== registryGeneration) {
        disposeModel(scene);
        resolve(scene);
        return;
      }
      entry.model = scene;
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        ownership.markGeometry(object.geometry);
        const values = Array.isArray(object.material) ? object.material : [object.material];
        const canonical = values.map(canonicalAssetMaterial);
        object.material = Array.isArray(object.material) ? canonical : canonical[0];
      });
      resolve(scene);
    }, undefined, reject);
  });
  assets.set(assetUrl, entry);
  return entry.promise;
}

export function disposeStreetObject(root: THREE.Object3D) {
  root.traverse((object) => {
    object.userData.disposed = true;
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
    if (!ownership.ownsGeometry(object.geometry) && !isSharedAvatarGeometry(object.geometry)) object.geometry?.dispose?.();
    const values = Array.isArray(object.material) ? object.material : [object.material];
    values.forEach((material) => {
      if (ownership.ownsMaterial(material) || isSharedAvatarMaterial(material)) return;
      disposeMaterial(material);
    });
  });
}

export function disposeStreetResourceRegistry() {
  registryGeneration += 1;
  for (const entry of assets.values()) {
    if (entry.model) disposeModel(entry.model);
  }
  assets.clear();
  geometries.forEach((geometry) => geometry.dispose());
  geometries.clear();
  materials.forEach((material) => material.dispose());
  materials.clear();
  assetMaterials.clear();
}

export function instanceRepeatedStaticMeshes(scene: THREE.Scene, excluded: ReadonlySet<THREE.Object3D>) {
  const groups = new Map<string, THREE.Mesh[]>();
  const worldPosition = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    if (excluded.has(object) || object.userData.interaction || object.userData.ground) return;
    let ancestor: THREE.Object3D | null = object.parent;
    while (ancestor) {
      if (excluded.has(ancestor) || ancestor.userData.interaction) return;
      ancestor = ancestor.parent;
    }
    if (!ownership.ownsGeometry(object.geometry) || Array.isArray(object.material) || !ownership.ownsMaterial(object.material)) return;
    object.getWorldPosition(worldPosition);
    const sector = `${Math.floor(worldPosition.x / 24)}:${Math.floor(worldPosition.z / 24)}`;
    const key = `${sector}:${object.geometry.uuid}:${object.material.uuid}:${object.castShadow ? 1 : 0}:${object.receiveShadow ? 1 : 0}`;
    const values = groups.get(key) || [];
    values.push(object);
    groups.set(key, values);
  });

  let savedDrawCalls = 0;
  const batches: THREE.InstancedMesh[] = [];
  groups.forEach((meshes) => {
    if (meshes.length < 3) return;
    const first = meshes[0];
    const instances = new THREE.InstancedMesh(first.geometry, first.material as THREE.Material, meshes.length);
    instances.name = `casas-static-batch-${meshes.length}`;
    instances.castShadow = first.castShadow;
    instances.receiveShadow = first.receiveShadow;
    meshes.forEach((mesh, index) => {
      instances.setMatrixAt(index, mesh.matrixWorld);
      mesh.removeFromParent();
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
    scene.add(instances);
    batches.push(instances);
    savedDrawCalls += meshes.length - 1;
  });
  return { savedDrawCalls, batches };
}

export function mergeStaticMeshesByMaterial(scene: THREE.Scene, excluded: ReadonlySet<THREE.Object3D>) {
  const groups = new Map<string, THREE.Mesh[]>();
  const worldPosition = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh) return;
    if (!object.visible || object.userData.avatarOwnedResource || excluded.has(object) || object.userData.interaction || object.userData.ground) return;
    if (Array.isArray(object.material) || object.material.transparent || Object.keys(object.morphTargetDictionary || {}).length) return;
    let ancestor: THREE.Object3D | null = object.parent;
    while (ancestor) {
      if (excluded.has(ancestor) || ancestor.userData.interaction) return;
      ancestor = ancestor.parent;
    }
    object.getWorldPosition(worldPosition);
    const sector = `${Math.floor(worldPosition.x / 24)}:${Math.floor(worldPosition.z / 24)}`;
    const attributes = Object.keys(object.geometry.attributes).sort().join(",");
    const key = `${sector}:${materialKey(object.material)}:${object.geometry.index ? 1 : 0}:${attributes}:${object.castShadow ? 1 : 0}:${object.receiveShadow ? 1 : 0}`;
    const meshes = groups.get(key) || [];
    meshes.push(object);
    groups.set(key, meshes);
  });

  let savedDrawCalls = 0;
  const mergedMeshes: THREE.Mesh[] = [];
  groups.forEach((meshes) => {
    if (meshes.length < 2) return;
    const transformed = meshes.map((mesh) => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    const merged = mergeGeometries(transformed, false);
    transformed.forEach((geometry) => geometry.dispose());
    if (!merged) return;
    const first = meshes[0];
    const result = new THREE.Mesh(merged, first.material);
    result.name = `casas-static-merge-${meshes.length}`;
    result.castShadow = first.castShadow;
    result.receiveShadow = first.receiveShadow;
    result.frustumCulled = true;
    merged.computeBoundingSphere();
    meshes.forEach((mesh) => mesh.removeFromParent());
    scene.add(result);
    mergedMeshes.push(result);
    savedDrawCalls += meshes.length - 1;
  });
  return { savedDrawCalls, meshes: mergedMeshes };
}

export function disableMicroShadowCasters(root: THREE.Object3D, minimumWorldRadius: number) {
  if (minimumWorldRadius <= 0) return 0;
  root.updateMatrixWorld(true);
  let disabled = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || !object.castShadow || object.userData.avatarOwnedResource) return;
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    const radius = (object.geometry.boundingSphere?.radius || 0) * object.matrixWorld.getMaxScaleOnAxis();
    if (radius >= minimumWorldRadius) return;
    object.castShadow = false;
    disabled += 1;
  });
  return disabled;
}
