import * as THREE from "three";
import type { Avatar3DRig } from "./runtime";

type SourceMesh = { mesh: THREE.Mesh; ownVisible: boolean };
type Batch = { instance: THREE.InstancedMesh; sources: SourceMesh[] };

const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

function parentsAreVisible(object: THREE.Object3D) {
  let parent = object.parent;
  while (parent) {
    if (!parent.visible) return false;
    parent = parent.parent;
  }
  return true;
}

export function createAvatarRenderBatch(scene: THREE.Scene) {
  let batches: Batch[] = [];

  const restoreSources = () => {
    batches.forEach(({ instance, sources }) => {
      instance.removeFromParent();
      sources.forEach(({ mesh, ownVisible }) => { mesh.visible = ownVisible; });
    });
    batches = [];
  };

  const update = () => {
    scene.updateMatrixWorld(true);
    batches.forEach(({ instance, sources }) => {
      sources.forEach(({ mesh, ownVisible }, index) => {
        instance.setMatrixAt(index, ownVisible && parentsAreVisible(mesh) ? mesh.matrixWorld : hiddenMatrix);
      });
      instance.instanceMatrix.needsUpdate = true;
    });
  };

  return {
    rebuild(rigs: Iterable<Avatar3DRig>) {
      restoreSources();
      const groups = new Map<string, SourceMesh[]>();
      for (const rig of rigs) {
        rig.root.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || object.material.transparent) return;
          if (!object.userData.avatarOwnedResource) return;
          const key = `${object.geometry.uuid}:${object.material.uuid}:${object.castShadow ? 1 : 0}:${object.receiveShadow ? 1 : 0}`;
          const sources = groups.get(key) || [];
          sources.push({ mesh: object, ownVisible: object.visible });
          groups.set(key, sources);
        });
      }
      groups.forEach((sources) => {
        if (sources.length < 2) return;
        const first = sources[0].mesh;
        const instance = new THREE.InstancedMesh(first.geometry, first.material as THREE.Material, sources.length);
        instance.name = `casas-avatar-batch-${sources.length}`;
        instance.castShadow = first.castShadow;
        instance.receiveShadow = first.receiveShadow;
        instance.frustumCulled = false;
        instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        sources.forEach(({ mesh }) => { mesh.visible = false; });
        scene.add(instance);
        batches.push({ instance, sources });
      });
      update();
      return batches.reduce((total, batch) => total + batch.sources.length - 1, 0);
    },
    update,
    dispose: restoreSources,
  };
}
