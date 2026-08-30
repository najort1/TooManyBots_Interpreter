import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Avatar3DRig } from "./runtime";

const AVATAR_RIG_ASSET_URL = "/casas/avatar/avatar-rig-v1.glb";
const REQUIRED_BONES = [
  "Root", "Hips", "Spine", "Head",
  "LeftUpperArm", "LeftLowerArm", "RightUpperArm", "RightLowerArm",
  "LeftUpperLeg", "LeftLowerLeg", "RightUpperLeg", "RightLowerLeg",
] as const;

type LoadedRigAsset = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};

export type BlenderAvatarAnimationRig = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: ReadonlyMap<string, THREE.AnimationAction>;
  bones: ReadonlyMap<string, THREE.Bone>;
  activeAction?: THREE.AnimationAction;
  disposed?: boolean;
};

let rigAssetPromise: Promise<LoadedRigAsset> | undefined;

function loadRigAsset() {
  if (rigAssetPromise) return rigAssetPromise;
  rigAssetPromise = new Promise<LoadedRigAsset>((resolve, reject) => {
    new GLTFLoader().load(
      AVATAR_RIG_ASSET_URL,
      ({ scene, animations }) => resolve({ scene, animations }),
      undefined,
      reject,
    );
  });
  return rigAssetPromise;
}

function collectBones(root: THREE.Group) {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((object) => {
    if (object instanceof THREE.Bone) bones.set(object.name, object);
  });
  const missing = REQUIRED_BONES.filter((name) => !bones.has(name));
  if (missing.length) throw new Error(`Rig de animação sem ossos obrigatórios: ${missing.join(", ")}`);
  return bones;
}

export async function createBlenderAvatarAnimationRig(): Promise<BlenderAvatarAnimationRig> {
  const asset = await loadRigAsset();
  const root = cloneSkeleton(asset.scene) as THREE.Group;
  root.name = "avatar-blender-animation-carrier";
  // The carrier drives the legacy modular body. It stays hidden so clothes,
  // hair and accessories keep their current visual implementation.
  root.visible = false;
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map(asset.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  return { root, mixer, actions, bones: collectBones(root) };
}

export function attachBlenderAvatarAnimationRig(rig: Avatar3DRig) {
  if (rig.blenderAnimation || rig.blenderAnimationLoading) return;
  rig.blenderAnimationLoading = true;
  void createBlenderAvatarAnimationRig()
    .then((animationRig) => {
      if (rig.disposed) {
        disposeBlenderAvatarAnimationRig(animationRig);
        return;
      }
      rig.blenderAnimation = animationRig;
      rig.blenderAnimationLoading = false;
      rig.root.add(animationRig.root);
      if (rig.pendingBlenderAnimation) playBlenderAvatarAnimation(rig, rig.pendingBlenderAnimation);
    })
    .catch((error) => {
      rig.blenderAnimationLoading = false;
      console.warn("Não foi possível preparar o rig de animação Blender.", error);
    });
}

export function playBlenderAvatarAnimation(rig: Avatar3DRig, name: string, fadeSeconds = .16) {
  rig.pendingBlenderAnimation = name;
  const animationRig = rig.blenderAnimation;
  if (!animationRig) return true;
  const action = animationRig.actions.get(name);
  if (!action) {
    rig.pendingBlenderAnimation = undefined;
    console.warn(`Clipe de animação Blender indisponível: ${name}`);
    return false;
  }
  if (animationRig.activeAction !== action) animationRig.activeAction?.fadeOut(fadeSeconds);
  action.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(fadeSeconds).play();
  animationRig.activeAction = action;
  return true;
}

function resetDrivenPose(rig: Avatar3DRig) {
  [
    rig.hips,
    rig.torso,
    rig.head,
    rig.leftArm,
    rig.rightArm,
    rig.leftForearm,
    rig.rightForearm,
    rig.leftLeg,
    rig.rightLeg,
    rig.leftKnee,
    rig.rightKnee,
  ].forEach((target) => target.rotation.set(0, 0, 0));
}

export function stopBlenderAvatarAnimation(rig: Avatar3DRig) {
  rig.pendingBlenderAnimation = undefined;
  const animationRig = rig.blenderAnimation;
  if (!animationRig?.activeAction) {
    resetDrivenPose(rig);
    return;
  }
  animationRig.activeAction.stop();
  animationRig.activeAction = undefined;
  resetDrivenPose(rig);
}

export function updateBlenderAvatarAnimation(rig: Avatar3DRig, delta: number) {
  const animationRig = rig.blenderAnimation;
  if (!animationRig?.activeAction) return false;
  animationRig.mixer.update(delta);
  const mappings: Array<[string, THREE.Object3D]> = [
    ["Hips", rig.hips],
    ["Spine", rig.torso],
    ["Head", rig.head],
    ["LeftUpperArm", rig.leftArm],
    ["RightUpperArm", rig.rightArm],
    ["LeftLowerArm", rig.leftForearm],
    ["RightLowerArm", rig.rightForearm],
    ["LeftUpperLeg", rig.leftLeg],
    ["RightUpperLeg", rig.rightLeg],
    ["LeftLowerLeg", rig.leftKnee],
    ["RightLowerLeg", rig.rightKnee],
  ];
  mappings.forEach(([boneName, target]) => target.rotation.copy(animationRig.bones.get(boneName)!.rotation));
  return true;
}

export function disposeBlenderAvatarAnimationRig(animationRig: BlenderAvatarAnimationRig) {
  if (animationRig.disposed) return;
  animationRig.disposed = true;
  animationRig.mixer.stopAllAction();
  animationRig.mixer.uncacheRoot(animationRig.root);
  animationRig.root.removeFromParent();
  animationRig.root.clear();
}
