import * as THREE from "three";
import type { HousePlayer } from "@/lib/types";
import { getAvatarVisualKey } from "../avatarAppearance.js";
import { migrateLegacyAvatarState } from "../../../../../shared/avatar/legacyMigration.js";
import { getAvatarPreviewSlots, normalizeAvatarSlots } from "../../../../../shared/avatar/domain.js";
import {
  AVATAR_SOCKET_NAMES,
  getAvatarBodyProfile,
  getAvatarBottomGarmentProfile,
  getAvatarBottomProfile,
  getAvatarHairCap,
  getAvatarHairProfile,
  getAvatarPalette,
  getAvatarShoeProfile,
  getAvatarTopProfile,
} from "./recipes.js";
import { disposeBlenderAvatarAnimationRig, updateBlenderAvatarAnimation } from "./blenderAnimationRig";
import type { BlenderAvatarAnimationRig } from "./blenderAnimationRig";
import {
  avatarBoxGeometry,
  avatarShadowMaterial,
  avatarStandardMaterial,
  isSharedAvatarGeometry,
  isSharedAvatarMaterial,
  shareAvatarGeometry,
} from "./resources";

export type Avatar3DStatus = "loading" | "ready" | "fallback" | "error";

type Limb = {
  pivot: THREE.Group;
  lower: THREE.Group;
  handOrFoot: THREE.Mesh;
};

type AvatarSockets = Record<string, THREE.Group>;

export type Avatar3DRig = {
  root: THREE.Group;
  model: THREE.Group;
  fallback: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftForearm: THREE.Group;
  rightForearm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  shadow: THREE.Mesh;
  voiceIndicator: THREE.Group;
  visualKey: string;
  walking: number;
  seated: number;
  status: Avatar3DStatus;
  appearance: THREE.Group;
  sockets: AvatarSockets;
  label: THREE.Sprite;
  blenderAnimation?: BlenderAvatarAnimationRig;
  pendingBlenderAnimation?: string;
  blenderAnimationLoading?: boolean;
  disposed?: boolean;
};

type AvatarInput = HousePlayer["avatar"] | { slots?: Record<string, string>; level?: number } | undefined;

const FLOOR_OFFSET = 0;
const SEATED_DROP = 0.42;

function material(color: number, roughness = 0.72, metalness = 0.03) {
  return avatarStandardMaterial(color, roughness, metalness);
}

function mesh(geometry: THREE.BufferGeometry, color: number, roughness = 0.72, metalness = 0.03) {
  const value = new THREE.Mesh(shareAvatarGeometry(geometry), material(color, roughness, metalness));
  value.castShadow = true;
  value.receiveShadow = true;
  value.userData.avatarOwnedResource = true;
  return value;
}

function glow(geometry: THREE.BufferGeometry, color: number, intensity = 0.8) {
  const value = new THREE.Mesh(shareAvatarGeometry(geometry), avatarStandardMaterial(color, 0.35, 0.18, color, intensity));
  value.castShadow = true;
  value.userData.avatarOwnedResource = true;
  return value;
}

function box(parent: THREE.Object3D, size: [number, number, number], color: number, position: [number, number, number], name = "") {
  const value = mesh(avatarBoxGeometry(size), color);
  value.position.set(...position);
  value.name = name;
  parent.add(value);
  return value;
}

function socket(parent: THREE.Object3D, key: keyof typeof AVATAR_SOCKET_NAMES, position: [number, number, number]) {
  const value = new THREE.Group();
  value.name = AVATAR_SOCKET_NAMES[key];
  value.position.set(...position);
  parent.add(value);
  return value;
}

function createLimb(parent: THREE.Object3D, x: number, y: number, skin: number, isArm: boolean, scale = 1): Limb {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  parent.add(pivot);
  const upper = box(
    pivot,
    isArm ? [0.32 * scale, 0.62 * scale, 0.34 * scale] : [0.42 * scale, 0.7 * scale, 0.46 * scale],
    skin,
    [0, -0.31 * scale, 0],
  );
  upper.position.y -= 0.02;
  const lower = new THREE.Group();
  lower.position.y = (isArm ? -0.64 : -0.72) * scale;
  pivot.add(lower);
  box(
    lower,
    isArm ? [0.3 * scale, 0.55 * scale, 0.32 * scale] : [0.39 * scale, 0.66 * scale, 0.43 * scale],
    skin,
    [0, -0.28 * scale, 0],
  );
  const handOrFoot = box(
    lower,
    isArm ? [0.34 * scale, 0.25 * scale, 0.38 * scale] : [0.43 * scale, 0.24 * scale, 0.66 * scale],
    skin,
    isArm ? [0, -0.67 * scale, 0.03] : [0, -0.76 * scale, 0.12],
  );
  return { pivot, lower, handOrFoot };
}

function resolveSlots(avatar: AvatarInput) {
  const source = avatar?.slots || {};
  if ("hair_face" in source || "outfit" in source) {
    return migrateLegacyAvatarState({ slots: source }).slots as Record<string, string>;
  }
  return normalizeAvatarSlots(source) as Record<string, string>;
}

function createBody(slots: Record<string, string>) {
  const palette = getAvatarPalette(slots);
  const model = new THREE.Group();
  model.name = "avatar-blocky-model";
  const proportions = getAvatarBodyProfile(slots.body);
  const bodySocket = socket(model, "body", [0, 0, 0]);
  const torso = new THREE.Group();
  torso.name = "avatar-torso";
  torso.position.y = 2.05;
  bodySocket.add(torso);
  box(torso, proportions.torso, palette.skin, [0, -0.04, 0]);
  const neckY = proportions.torso[1] / 2 + 0.11;
  const neck = box(torso, [0.25, 0.22, 0.27], palette.skin, [0, neckY, 0]);
  neck.name = "avatar-neck";
  const head = new THREE.Group();
  head.name = "avatar-head";
  head.position.set(0, proportions.headY, 0);
  bodySocket.add(head);
  const headMesh = box(head, proportions.head, palette.skin, [0, 0, 0]);
  headMesh.position.y += 0.01;

  const leftArm = createLimb(bodySocket, -proportions.armX, 2.43, palette.skin, true, proportions.limbScale);
  const rightArm = createLimb(bodySocket, proportions.armX, 2.43, palette.skin, true, proportions.limbScale);
  const leftLeg = createLimb(bodySocket, -proportions.legX, 1.47, palette.skin, false, proportions.limbScale);
  const rightLeg = createLimb(bodySocket, proportions.legX, 1.47, palette.skin, false, proportions.limbScale);

  const sockets: AvatarSockets = {
    root: socket(model, "root", [0, 0, 0]),
    body: bodySocket,
    face: socket(head, "face", [0, 0, proportions.head[2] / 2 + 0.02]),
    hair: socket(head, "hair", [0, proportions.head[1] / 2 + 0.02, 0]),
    head: socket(head, "head", [0, proportions.head[1] / 2 + 0.08, 0]),
    neck: socket(torso, "neck", [0, neckY - 0.11, 0.02]),
    back: socket(torso, "back", [0, 0.05, -0.36]),
    waist: socket(torso, "waist", [0, -(proportions.torso[1] / 2 + 0.03), 0]),
    feet: socket(bodySocket, "feet", [0, 0.03, 0]),
    "torso-arms": socket(torso, "torso-arms", [0, 0, 0]),
    "waist-legs": socket(bodySocket, "waist-legs", [0, 1.47, 0]),
  };

  return { model, torso, head, sockets, palette, proportions, leftArm, rightArm, leftLeg, rightLeg };
}

function composeAppearance(parts: ReturnType<typeof createBody>, slots: Record<string, string>) {
  const appearance = new THREE.Group();
  appearance.name = "avatar-appearance";
  parts.model.add(appearance);
  composeFace(parts.sockets.face, slots.face, parts.palette);
  composeHair(parts.sockets.hair, slots.hair, parts.palette);
  composeTop(parts, slots.top);
  composeBottom(parts, slots.bottom);
  composeShoes(parts, slots.shoes);
  composeHeadAccessory(parts.sockets.head, slots.headAccessory, parts.palette);
  composeFaceAccessory(parts.sockets.face, slots.faceAccessory, parts.palette);
  composeNeckAccessory(parts.sockets.neck, slots.neckAccessory, parts.palette);
  composeBackAccessory(parts.sockets.back, slots.backAccessory, parts.palette);
  composeWaistAccessory(parts.sockets.waist, slots.waistAccessory, parts.palette);
  return appearance;
}

function composeFace(parent: THREE.Group, face: string, palette: ReturnType<typeof getAvatarPalette>) {
  if (face === "none") return;
  const group = namedGroup(parent, "slot-face");
  const cheerful = face === "face_sorriso";
  const confident = face === "face_confiante";
  const eyesY = confident ? 0.09 : 0.11;
  const eyeHeight = confident ? 0.1 : cheerful ? 0.132 : 0.118;

  [-0.2, 0.2].forEach((x) => {
    // Block eyes with a single pixel-like catchlight preserve the Roblox
    // language while making the gaze legible from the studio camera.
    const eye = mesh(new THREE.BoxGeometry(0.112, eyeHeight, 0.038), palette.ink, 0.58, 0.08);
    eye.name = "face-eye";
    eye.position.set(x, eyesY, 0.066);
    eye.castShadow = false;
    eye.receiveShadow = false;
    group.add(eye);

    const highlight = mesh(new THREE.BoxGeometry(0.026, 0.026, 0.012), 0xfff6e6, 0.34, 0.06);
    highlight.name = "face-eye-highlight";
    highlight.position.set(x + 0.02, eyesY + eyeHeight * 0.19, 0.092);
    highlight.castShadow = false;
    highlight.receiveShadow = false;
    group.add(highlight);
  });

  if (confident) {
    addEyebrow(group, -0.2, 0.24, -0.17, palette.ink);
    addEyebrow(group, 0.2, 0.24, 0.17, palette.ink);
    addSmirk(group, palette.ink);
  } else {
    addSmile(group, palette.ink, cheerful ? 0.38 : 0.32, cheerful ? 0.13 : 0.075, cheerful ? -0.14 : -0.17);
  }
}

function addSmile(group: THREE.Group, color: number, width: number, depth: number, y: number) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-width / 2, 0, 0),
    new THREE.Vector3(0, -depth, 0),
    new THREE.Vector3(width / 2, 0, 0),
  );
  const mouth = mesh(new THREE.TubeGeometry(curve, 16, 0.019, 6, false), color, 0.9, 0);
  mouth.name = "face-smile";
  mouth.position.set(0, y, 0.035);
  group.add(mouth);
}

function addSmirk(group: THREE.Group, color: number) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.16, -0.025, 0),
    new THREE.Vector3(0, -0.06, 0),
    new THREE.Vector3(0.16, 0.05, 0),
  );
  const mouth = mesh(new THREE.TubeGeometry(curve, 16, 0.018, 6, false), color, 0.9, 0);
  mouth.name = "face-smirk";
  mouth.position.set(0, -0.18, 0.035);
  group.add(mouth);
}

function addEyebrow(group: THREE.Group, x: number, y: number, tilt: number, color: number) {
  const brow = mesh(new THREE.CapsuleGeometry(0.018, 0.13, 4, 8), color, 0.9, 0);
  brow.name = "face-eyebrow";
  brow.rotation.z = Math.PI / 2 + tilt;
  brow.position.set(x, y, 0.032);
  group.add(brow);
}

function composeHair(parent: THREE.Group, hair: string, palette: ReturnType<typeof getAvatarPalette>) {
  if (hair === "none") return;
  const group = namedGroup(parent, "slot-hair");
  const profile = getAvatarHairProfile(hair);
  addHairCap(group, hair, palette.hair);
  addBackHair(group, profile, palette.hair);
  if (profile?.style === "curls") {
    addCurlyHair(group, profile, palette.hair);
    return;
  }
  if (profile?.style === "braids") addBraids(group, profile, palette.hair, palette.gold);
  else if (profile?.style === "long" || profile?.style === "pigtails") addLongHair(group, profile, palette.hair);
  if (hair.includes("caos")) {
    [-0.28, 0, 0.28].forEach((x, index) => {
      const spike = mesh(new THREE.ConeGeometry(0.16, 0.42 + (index % 2) * 0.1, 4), palette.hair);
      spike.position.set(x, 0.34, 0);
      group.add(spike);
    });
  }
  if (hair.includes("franja")) [-0.22, 0, 0.22].forEach((x) => box(group, [0.2, 0.24, 0.09], palette.hair, [x, -0.18, 0.45]));
}

function addHairCap(group: THREE.Group, hair: string, color: number) {
  // A model viewed from three angles needs a real volume around the skull:
  // crown, nape and both temples. The face centre deliberately stays open.
  getAvatarHairCap(hair).forEach(({ size, position }) => {
    box(group, size as [number, number, number], color, position as [number, number, number]);
  });
}

function addCurlyHair(group: THREE.Group, profile: { length: number; width: number }, color: number) {
  // Each curl is a low-poly helix, not a floating sphere. The roots wrap the
  // forehead, temples and nape, so the silhouette remains curly in all views.
  const curls: Array<[number, number, number, number, number]> = [
    [-0.34, 0.16, 0.47, 0.5, 0.1], [-0.12, 0.2, 0.5, 0.55, 1.2], [0.12, 0.2, 0.5, 0.55, 2.4], [0.34, 0.16, 0.47, 0.5, 3.5],
    [-0.55, 0.08, 0.28, 0.59, 0.8], [0.55, 0.08, 0.28, 0.59, 2.1],
    [-0.56, -0.18, -0.08, 0.47, 2.8], [0.56, -0.18, -0.08, 0.47, 4],
    [-0.33, 0.12, -0.5, 0.56, 0.6], [-0.11, 0.18, -0.52, 0.51, 1.7], [0.11, 0.18, -0.52, 0.51, 2.9], [0.33, 0.12, -0.5, 0.56, 4.1],
  ];
  const segments = 18;

  curls.forEach(([x, y, z, lengthScale, phase], index) => {
    const points = Array.from({ length: segments + 1 }, (_, step) => {
      const progress = step / segments;
      const angle = phase + progress * Math.PI * 4.1;
      const radius = profile.width * (1.18 - progress * 0.28);
      return new THREE.Vector3(
        x + Math.cos(angle) * radius,
        y - progress * profile.length * lengthScale,
        z + Math.sin(angle) * radius,
      );
    });
    const lock = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, profile.width * 0.48, 6, false), color, 0.84, 0);
    lock.name = `curl-lock-${index}`;
    group.add(lock);

    const tip = mesh(new THREE.DodecahedronGeometry(profile.width * 0.66, 0), color, 0.84, 0);
    tip.position.copy(points.at(-1)!);
    tip.name = `curl-tip-${index}`;
    group.add(tip);
  });
}

function addBackHair(
  group: THREE.Group,
  profile: { style: string; length: number; y: number } | null,
  color: number,
) {
  if (profile?.style === "long") {
    // Keep the rear curtain divided into locks. It covers the nape in the
    // back view without turning long hair into a single flat slab.
    [-0.34, -0.17, 0, 0.17, 0.34].forEach((x, index) => {
      const length = profile.length - (index === 0 || index === 4 ? 0.18 : 0);
      const y = profile.y + (profile.length - length) / 2;
      box(group, [0.17, length, 0.15], color, [x, y, -0.46]);
    });
    return;
  }

  if (profile?.style === "braids") {
    [-0.28, 0, 0.28].forEach((x, index) => {
      const braid = mesh(new THREE.CylinderGeometry(0.12, 0.14, profile.length - Math.abs(index - 1) * 0.12, 6), color);
      braid.position.set(x, profile.y, -0.46);
      group.add(braid);
    });
    return;
  }

}

function addLongHair(group: THREE.Group, profile: { style: string; length: number; width: number; y: number }, color: number) {
  const xOffset = profile.style === "pigtails" ? 0.56 : 0.49;
  const zOffset = profile.style === "pigtails" ? 0.08 : 0.24;
  [-xOffset, xOffset].forEach((x) => {
    // Long locks stay in front of the shoulder line so the length remains
    // legible from the default studio camera instead of disappearing behind
    // the torso.
    box(group, [profile.width, profile.length, 0.2], color, [x, profile.y, zOffset]);
    const end = mesh(new THREE.DodecahedronGeometry(profile.width * 0.72, 0), color);
    end.position.set(x, profile.y - profile.length / 2, zOffset);
    group.add(end);
  });
}

function addBraids(group: THREE.Group, profile: { length: number; width: number; y: number }, color: number, beadColor: number) {
  [-0.38, 0.38].forEach((x) => {
    const braid = mesh(new THREE.CylinderGeometry(profile.width * 0.75, profile.width, profile.length, 6), color);
    braid.position.set(x, profile.y, 0.18);
    group.add(braid);
    [-0.22, 0.2].forEach((offset) => {
      const bead = glow(new THREE.SphereGeometry(profile.width * 0.65, 8, 6), beadColor, 0.35);
      bead.position.set(x, profile.y + profile.length * offset, 0.18);
      group.add(bead);
    });
  });
}

function composeTop(parts: ReturnType<typeof createBody>, top: string) {
  if (top === "none") return;
  const color = parts.palette.top;
  const torsoGroup = namedGroup(parts.torso, "slot-top");
  const garment = getAvatarTopProfile(top);
  const torsoWidth = parts.proportions.topWidth * garment.width;
  const torsoHeight = parts.proportions.torso[1] * garment.height;
  const sleeveScale = parts.proportions.limbScale * garment.sleeve;
  box(torsoGroup, [torsoWidth, torsoHeight, parts.proportions.torso[2] + 0.06], color, [0, garment.y, 0]);
  [parts.leftArm, parts.rightArm].forEach((arm) => {
    box(arm.pivot, [0.38 * sleeveScale, 0.46 * sleeveScale, 0.4 * sleeveScale], color, [0, -0.2 * sleeveScale, 0]);
  });

  if (garment.shape === "jacket" || garment.shape === "armor") {
    [-0.29, 0.29].forEach((x) => box(torsoGroup, [0.06, 0.76, 0.025], parts.palette.accent, [x, -0.03, 0.365]));
  }
  if (garment.shape === "jacket") {
    box(torsoGroup, [torsoWidth * 0.35, torsoHeight * 0.76, 0.055], 0x273553, [0, garment.y - 0.02, 0.39]);
    box(torsoGroup, [torsoWidth * 0.84, 0.07, 0.06], 0x19213d, [0, garment.y - torsoHeight / 2 + 0.03, 0.4]);
    [-1, 1].forEach((side) => {
      const lapel = box(torsoGroup, [0.19, 0.34, 0.065], 0xff86c8, [side * torsoWidth * 0.21, garment.y + 0.25, 0.42]);
      lapel.rotation.z = side * -0.46;
    });
  }
  if (garment.shape === "blazer") {
    box(torsoGroup, [0.27, 0.75, 0.035], 0xf3eadb, [0, -0.02, 0.37]);
    box(torsoGroup, [0.09, 0.38, 0.04], 0xa33b4d, [0, -0.14, 0.395]);
    [-1, 1].forEach((side) => {
      const lapel = box(torsoGroup, [0.2, 0.46, 0.05], 0x1b243e, [side * 0.23, 0.02, 0.4]);
      lapel.rotation.z = side * -0.42;
    });
  }
  if (garment.shape === "hoodie") {
    const hood = mesh(new THREE.TorusGeometry(0.34, 0.07, 7, 20), 0xd8efff);
    hood.rotation.x = Math.PI / 2;
    hood.position.set(0, 0.48, -0.05);
    torsoGroup.add(hood);
    box(torsoGroup, [torsoWidth * 0.46, 0.2, 0.055], 0xc7e8ff, [0, -0.24, 0.39]);
    [-0.11, 0.11].forEach((x) => box(torsoGroup, [0.025, 0.22, 0.035], 0xffffff, [x, 0.26, 0.4]));
  }
  if (garment.shape === "overshirt") {
    [-0.25, 0, 0.25].forEach((x) => box(torsoGroup, [0.035, 0.82, 0.025], 0xf5c7a9, [x, -0.04, 0.37]));
    [-0.34, 0.02, 0.35].forEach((y) => box(torsoGroup, [torsoWidth * 0.84, 0.035, 0.025], 0x512b3d, [0, y, 0.37]));
  }
  if (garment.shape === "varsity" || garment.shape === "school-jacket") {
    box(torsoGroup, [torsoWidth * 0.86, 0.07, 0.05], garment.shape === "varsity" ? 0xf6d365 : 0xf7e5c1, [0, -0.41, 0.39]);
    box(torsoGroup, [0.42, 0.28, 0.045], garment.shape === "varsity" ? 0x182238 : 0xf4c857, [0, -0.02, 0.4]);
  }
  if (garment.shape === "dress-bodice" || garment.shape === "off-shoulder") {
    box(torsoGroup, [torsoWidth * 0.72, 0.08, 0.05], 0xffd6c4, [0, 0.31, 0.39]);
    if (garment.shape === "off-shoulder") {
      [-0.48, 0.48].forEach((x) => box(torsoGroup, [0.22, 0.12, 0.08], color, [x, 0.25, 0.04]));
    }
  }
  if (garment.shape === "overalls") {
    [-0.24, 0.24].forEach((x) => {
      const strap = box(torsoGroup, [0.11, 0.63, 0.06], 0x5b4937, [x, 0.02, 0.39]);
      strap.rotation.z = x < 0 ? 0.18 : -0.18;
    });
    box(torsoGroup, [0.4, 0.24, 0.06], 0xf0be62, [0, -0.08, 0.41]);
  }
  if (garment.shape === "armor") {
    [-0.55, 0.55].forEach((x) => box(torsoGroup, [0.32, 0.18, 0.76], 0x5068aa, [x, 0.34, 0]));
    box(torsoGroup, [0.3, 0.26, 0.055], 0x111b39, [0, -0.03, 0.41]);
  }
  if (garment.shape === "cropped" || garment.shape === "cropped-cardigan") {
    box(torsoGroup, [torsoWidth * 0.86, 0.055, 0.055], garment.shape === "cropped" ? parts.palette.accent : 0xffc2df, [0, garment.y - torsoHeight / 2 - 0.03, 0.39]);
    if (garment.shape === "cropped-cardigan") box(torsoGroup, [0.06, torsoHeight * 0.82, 0.05], 0xffd6e9, [0, garment.y, 0.4]);
  }
  if (garment.shape === "oversized") {
    box(torsoGroup, [torsoWidth * 1.04, 0.18, parts.proportions.torso[2] + 0.08], color, [0, garment.y - torsoHeight / 2 + 0.04, 0]);
    [-1, 1].forEach((side) => box(torsoGroup, [0.13, 0.24, 0.08], 0x273553, [side * torsoWidth * 0.42, garment.y - 0.36, 0.39]));
  }
  if (garment.shape === "polo") {
    box(torsoGroup, [0.36, 0.16, 0.055], 0xf6e6b7, [0, 0.34, 0.4]);
    box(torsoGroup, [0.06, 0.42, 0.055], 0xf6e6b7, [0, 0.08, 0.4]);
    [-0.12, 0.12].forEach((x) => box(torsoGroup, [0.04, 0.04, 0.06], 0x6e4b32, [x, 0.34, 0.42]));
  }
}

function composeBottom(parts: ReturnType<typeof createBody>, bottom: string) {
  if (bottom === "none") return;
  const color = parts.palette.bottom;
  const garment = getAvatarBottomGarmentProfile(bottom);
  const legWidth = parts.proportions.legWidth * garment.width;
  [parts.leftLeg, parts.rightLeg].forEach((leg) => {
    if (garment.shape !== "skirt") {
      box(leg.pivot, [legWidth, 0.72 * garment.upper * parts.proportions.limbScale, 0.49 * parts.proportions.limbScale], color, [0, -0.34 * parts.proportions.limbScale, 0]);
      if (garment.lower > 0) {
        box(leg.lower, [Math.max(0.12, legWidth - 0.03), 0.66 * garment.lower * parts.proportions.limbScale, 0.46 * parts.proportions.limbScale], color, [0, -0.31 * parts.proportions.limbScale, 0]);
      }
    }
  });
  const bottomProfile = getAvatarBottomProfile(bottom);
  if (bottomProfile?.skirt) {
    const skirt = mesh(new THREE.CylinderGeometry(bottomProfile.topRadius, bottomProfile.bottomRadius, bottomProfile.height, 4), color);
    skirt.position.set(0, bottomProfile.y, 0);
    skirt.rotation.y = Math.PI / 4;
    parts.sockets["waist-legs"].add(skirt);
  }
  if (garment.shape === "cargo") {
    [parts.leftLeg, parts.rightLeg].forEach((leg) => box(leg.pivot, [legWidth + 0.08, 0.22, 0.12], 0x53356f, [0, -0.44 * parts.proportions.limbScale, 0.27]));
  }
  if (garment.shape === "jogger" || garment.shape === "baggy") {
    [parts.leftLeg, parts.rightLeg].forEach((leg) => box(leg.lower, [legWidth * 0.82, 0.1, 0.5], 0x202b44, [0, -0.56 * parts.proportions.limbScale, 0]));
  }
  if (garment.shape === "tailored" || garment.shape === "chinos") {
    [parts.leftLeg, parts.rightLeg].forEach((leg) => box(leg.pivot, [0.035, 0.82 * parts.proportions.limbScale, 0.03], 0xe9dfc9, [0, -0.37 * parts.proportions.limbScale, 0.26]));
  }
  if (garment.shape === "shorts") {
    [parts.leftLeg, parts.rightLeg].forEach((leg) => box(leg.lower, [parts.proportions.legWidth + 0.04, 0.18, 0.5], 0xe9ecff, [0, -0.26 * parts.proportions.limbScale, 0]));
  }
  if (garment.shape === "workwear") {
    [parts.leftLeg, parts.rightLeg].forEach((leg) => box(leg.lower, [legWidth * 0.86, 0.24, 0.5], 0xb98c47, [0, -0.23 * parts.proportions.limbScale, 0.24]));
  }
  if (garment.shape === "armor") {
    [parts.leftLeg, parts.rightLeg].forEach((leg) => box(leg.lower, [legWidth + 0.08, 0.22, 0.56], 0x5068aa, [0, -0.2 * parts.proportions.limbScale, 0.04]));
  }
  if (bottom.includes("lilas")) box(parts.sockets["waist-legs"], [parts.proportions.topWidth * 0.86, 0.28, parts.proportions.torso[2]], color, [0, 0.05, 0]);
}

function composeShoes(parts: ReturnType<typeof createBody>, shoes: string) {
  if (shoes === "none") return;
  const group = namedGroup(parts.sockets.feet, "slot-shoes");
  const color = parts.palette.shoes;
  const shoe = getAvatarShoeProfile(shoes);
  const width = parts.proportions.shoeWidth * shoe.width;
  [-parts.proportions.legX, parts.proportions.legX].forEach((x) => box(group, [width, 0.27 * shoe.height, 0.72 * shoe.depth], color, [x, 0.1, 0.12]));
  if (shoe.shape === "loafer") {
    [-parts.proportions.legX, parts.proportions.legX].forEach((x) => box(group, [width * 0.9, 0.08, 0.77 * shoe.depth], 0xf3eadb, [x, -0.02, 0.17]));
  } else if (shoe.shape === "heel") {
    [-parts.proportions.legX, parts.proportions.legX].forEach((x) => {
      box(group, [width * 0.7, 0.34, 0.76 * shoe.depth], color, [x, 0.14, 0.14]);
      box(group, [0.12, 0.28, 0.22], 0x161521, [x, -0.08, -0.13]);
    });
  } else if (shoe.shape === "boot" || shoe.shape === "high-top") {
    [-parts.proportions.legX, parts.proportions.legX].forEach((x) => box(group, [width * 0.9, 0.28 * shoe.height, 0.62 * shoe.depth], shoe.shape === "high-top" ? parts.palette.accent : color, [x, 0.3, 0.03]));
  } else if (shoe.shape === "platform" || shoe.shape === "chunky") {
    [-parts.proportions.legX, parts.proportions.legX].forEach((x) => box(group, [width * 1.06, shoe.shape === "chunky" ? 0.13 : 0.1, 0.78 * shoe.depth], shoe.shape === "chunky" ? 0x273553 : 0xf1d5ff, [x, -0.05, 0.14]));
  } else {
    [-parts.proportions.legX, parts.proportions.legX].forEach((x) => box(group, [width + 0.035, 0.07, 0.75 * shoe.depth], shoe.shape === "cloud-sneaker" ? 0xd8efff : 0xe9ecff, [x, -0.025, 0.13]));
  }
  if (shoes.includes("neon") || shoes.includes("arcade") || shoes.includes("astral")) {
    [-parts.proportions.legX, parts.proportions.legX].forEach((x) => box(group, [parts.proportions.shoeWidth + 0.03, 0.06, 0.74], parts.palette.accent, [x, -0.03, 0.12]));
  }
}

function composeHeadAccessory(parent: THREE.Group, id: string, palette: ReturnType<typeof getAvatarPalette>) {
  if (id === "none") return;
  const group = namedGroup(parent, "slot-head-accessory");
  if (id.includes("fones")) {
    const band = mesh(new THREE.TorusGeometry(0.5, 0.055, 7, 20, Math.PI), 0x8b5cf6);
    band.position.y = -0.08;
    group.add(band);
    [-0.49, 0.49].forEach((x) => box(group, [0.16, 0.3, 0.2], palette.accent, [x, -0.29, 0]));
  } else if (id.includes("bone") || id.includes("chapeu")) {
    box(group, [1.05, 0.25, 0.96], id.includes("bone") ? 0x6f54d7 : 0xd8b46d, [0, 0.04, 0]);
    box(group, [0.92, 0.08, 0.35], id.includes("bone") ? 0x6f54d7 : 0xd8b46d, [0, -0.08, 0.48]);
  } else if (id.includes("coroa")) {
    [-0.28, 0, 0.28].forEach((x, index) => {
      const spike = mesh(new THREE.ConeGeometry(0.14, 0.35 + (index === 1 ? 0.12 : 0), 4), palette.gold);
      spike.position.set(x, 0.15, 0);
      group.add(spike);
    });
  } else if (id.includes("tiara") || id.includes("laco") || id.includes("bandana")) {
    const band = mesh(new THREE.TorusGeometry(0.47, 0.035, 7, 20, Math.PI), id.includes("bandana") ? 0xef5d6f : 0xc6a7ff);
    group.add(band);
    if (id.includes("laco")) [-0.16, 0.16].forEach((x) => box(group, [0.24, 0.18, 0.09], 0xf56fa8, [x, 0.1, 0.2]));
  }
}

function composeFaceAccessory(parent: THREE.Group, id: string, palette: ReturnType<typeof getAvatarPalette>) {
  if (id === "none") return;
  const group = namedGroup(parent, "slot-face-accessory");
  if (id.includes("oculos")) {
    [-0.22, 0.22].forEach((x) => {
      box(group, [0.34, 0.23, 0.045], 0x27304d, [x, 0.1, 0.045]);
      box(group, [0.23, 0.13, 0.012], 0x84e4ff, [x, 0.1, 0.072]);
    });
    box(group, [0.13, 0.04, 0.05], 0x27304d, [0, 0.1, 0.045]);
  } else if (id.includes("mascara")) {
    box(group, [0.84, 0.38, 0.07], 0x4c396f, [0, 0.04, 0.05]);
    [-0.22, 0.22].forEach((x) => box(group, [0.18, 0.08, 0.018], palette.gold, [x, 0.08, 0.092]));
  } else if (id.includes("brincos")) {
    [-0.55, 0.55].forEach((x) => {
      const gem = glow(new THREE.OctahedronGeometry(0.07, 0), palette.accent, 0.5);
      gem.position.set(x, -0.18, 0);
      group.add(gem);
    });
  }
}

function composeNeckAccessory(parent: THREE.Group, id: string, palette: ReturnType<typeof getAvatarPalette>) {
  if (id === "none") return;
  const group = namedGroup(parent, "slot-neck-accessory");
  const color = id.includes("cachecol") ? 0xef78a5 : palette.gold;
  const collar = mesh(new THREE.TorusGeometry(0.4, id.includes("cachecol") ? 0.07 : 0.025, 8, 24), color);
  collar.rotation.x = Math.PI / 2;
  group.add(collar);
  if (id.includes("corrente")) {
    const gem = glow(new THREE.DodecahedronGeometry(0.08, 0), palette.gold, 0.5);
    gem.position.set(0, -0.35, 0.36);
    group.add(gem);
  }
}

function composeBackAccessory(parent: THREE.Group, id: string, palette: ReturnType<typeof getAvatarPalette>) {
  if (id === "none") return;
  const group = namedGroup(parent, "slot-back-accessory");
  if (id.includes("asas")) {
    [-1, 1].forEach((side) => {
      const wing = box(group, [0.58, 0.78, 0.12], 0xdceeff, [side * 0.58, 0.08, -0.08]);
      wing.rotation.z = side * -0.35;
    });
  } else if (id.includes("aura")) {
    const ring = glow(new THREE.TorusGeometry(0.93, 0.045, 8, 32), 0x86d7f6, 0.7);
    ring.position.z = -0.1;
    group.add(ring);
  } else {
    box(group, [0.72, 0.72, 0.25], 0x5378af, [0, 0, -0.1]);
    box(group, [0.5, 0.12, 0.04], palette.accent, [0, 0.17, -0.24]);
  }
}

function composeWaistAccessory(parent: THREE.Group, id: string, palette: ReturnType<typeof getAvatarPalette>) {
  if (id === "none") return;
  const group = namedGroup(parent, "slot-waist-accessory");
  const bagColor = id.includes("estelar") ? 0x384172 : 0xf17d81;
  box(group, [0.44, 0.42, 0.22], bagColor, [0.58, -0.25, 0.17]);
  const strap = mesh(new THREE.TorusGeometry(0.52, 0.035, 8, 22, Math.PI), id.includes("estelar") ? 0x8d6ada : palette.gold);
  strap.rotation.z = Math.PI / 2;
  strap.position.set(0.26, 0.05, 0.12);
  group.add(strap);
}

function namedGroup(parent: THREE.Object3D, name: string) {
  const group = new THREE.Group();
  group.name = name;
  parent.add(group);
  return group;
}

function createLabel(text: string, local: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D indisponível para o nome do avatar.");
  context.beginPath();
  context.roundRect(8, 8, 496, 112, 34);
  context.fillStyle = local ? "rgba(124,58,237,.95)" : "rgba(24,21,35,.9)";
  context.fill();
  context.strokeStyle = local ? "#f6d365" : "rgba(255,255,255,.3)";
  context.lineWidth = 8;
  context.stroke();
  context.fillStyle = "#fff";
  context.font = "800 52px ui-monospace, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text.slice(0, 18), 256, 66, 450);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  label.name = "avatar-name-label";
  label.scale.set(1.85, 0.46, 1);
  label.position.y = 4.05;
  return label;
}

function createVoiceIndicator() {
  const group = new THREE.Group();
  group.name = "avatar-voice-indicator";
  group.position.set(0, 4.5, 0);
  [-0.18, 0, 0.18].forEach((x, index) => {
    const dot = glow(new THREE.SphereGeometry(0.065, 10, 8), 0x72efff, 1.3);
    dot.position.set(x, index === 1 ? 0.08 : 0, 0);
    group.add(dot);
  });
  group.visible = false;
  return group;
}

export function createAvatar3D(avatar: AvatarInput, labelText: string) {
  const slots = resolveSlots(avatar);
  const parts = createBody(slots);
  const appearance = composeAppearance(parts, slots);
  const root = new THREE.Group();
  root.name = "avatar-root";
  root.add(parts.model);
  const shadow = new THREE.Mesh(shareAvatarGeometry(new THREE.CircleGeometry(0.78, 32)), avatarShadowMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = 0.42;
  shadow.position.y = 0.008;
  shadow.userData.avatarOwnedResource = true;
  root.add(shadow);
  const voiceIndicator = createVoiceIndicator();
  root.add(voiceIndicator);
  const label = createLabel(labelText, labelText === "VOCÊ");
  root.add(label);
  const rig: Avatar3DRig = {
    root,
    model: parts.model,
    fallback: new THREE.Group(),
    hips: parts.sockets.body,
    torso: parts.torso,
    head: parts.head,
    leftArm: parts.leftArm.pivot,
    rightArm: parts.rightArm.pivot,
    leftForearm: parts.leftArm.lower,
    rightForearm: parts.rightArm.lower,
    leftLeg: parts.leftLeg.pivot,
    rightLeg: parts.rightLeg.pivot,
    leftKnee: parts.leftLeg.lower,
    rightKnee: parts.rightLeg.lower,
    shadow,
    voiceIndicator,
    visualKey: getAvatarVisualKey({ slots }),
    walking: 0,
    seated: 0,
    status: "ready",
    appearance,
    sockets: parts.sockets,
    label,
  };
  return rig;
}

let sharedPreviewRenderer: THREE.WebGLRenderer | null = null;
let sharedPreviewScene: THREE.Scene | null = null;
let sharedPreviewCamera: THREE.PerspectiveCamera | null = null;

function getPreviewRenderer(size: number) {
  if (!sharedPreviewRenderer) {
    sharedPreviewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    sharedPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    sharedPreviewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    sharedPreviewRenderer.toneMappingExposure = 1.05;
    sharedPreviewRenderer.setPixelRatio(1);
  }
  sharedPreviewRenderer.setSize(size, size, false);

  if (!sharedPreviewScene) {
    sharedPreviewScene = new THREE.Scene();
    sharedPreviewScene.background = new THREE.Color(0x231733);
    sharedPreviewScene.add(new THREE.HemisphereLight(0xd8d5ff, 0x171020, 2.25));
    const light = new THREE.DirectionalLight(0xffe4c0, 3.1);
    light.position.set(4, 7, 5);
    sharedPreviewScene.add(light);
  }

  if (!sharedPreviewCamera) {
    sharedPreviewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    sharedPreviewCamera.position.set(2.7, 2.55, 6.7);
    sharedPreviewCamera.lookAt(0, 2.05, 0);
  }

  return { renderer: sharedPreviewRenderer, scene: sharedPreviewScene, camera: sharedPreviewCamera };
}

function focusPreviewCamera(camera: THREE.PerspectiveCamera, slot: string) {
  if (slot === "bottom") {
    camera.position.set(2.25, 1.55, 5.45);
    camera.lookAt(0, 1.32, 0);
    return;
  }
  if (slot === "shoes") {
    camera.position.set(1.75, 0.72, 4.45);
    camera.lookAt(0, 0.48, 0.08);
    return;
  }
  camera.position.set(2.7, 2.55, 6.7);
  camera.lookAt(0, 2.05, 0);
}

export function createAvatarPreview(item: { slot: string; id: string; sourceProductId?: string }, size = 192) {
  const slots = getAvatarPreviewSlots(item) as Record<string, string>;
  const rig = createAvatar3D({ slots }, "");
  rig.label.visible = false;
  rig.voiceIndicator.visible = false;

  const { renderer, scene, camera } = getPreviewRenderer(size);
  focusPreviewCamera(camera, item.slot);

  // Remove any previous avatar from the preview scene (keep lights)
  const previous = scene.getObjectByName("avatar-root");
  if (previous) scene.remove(previous);

  scene.add(rig.root);
  renderer.render(scene, camera);

  const dataUrl = renderer.domElement.toDataURL("image/webp", 0.82);
  scene.remove(rig.root);
  disposeAvatar3D(rig);
  return dataUrl;
}

export function updateAvatar3D(rig: Avatar3DRig, avatar: AvatarInput, labelText = "VOCÊ") {
  const key = getAvatarVisualKey({ slots: resolveSlots(avatar) });
  if (key === rig.visualKey) return rig;
  const replacement = createAvatar3D(avatar, labelText);
  replacement.root.position.copy(rig.root.position);
  replacement.root.rotation.copy(rig.root.rotation);
  replacement.root.scale.copy(rig.root.scale);
  replacement.walking = rig.walking;
  replacement.seated = rig.seated;
  replacement.pendingBlenderAnimation = rig.pendingBlenderAnimation;
  replacement.voiceIndicator.visible = rig.voiceIndicator.visible;
  replacement.model.position.copy(rig.model.position);
  replacement.model.rotation.copy(rig.model.rotation);
  return replacement;
}

export function animateAvatar3D(rig: Avatar3DRig, elapsed: number, moving: boolean, seatedAmount: number, reducedMotion = false, delta = 1 / 60, speaking = false) {
  rig.walking = THREE.MathUtils.damp(rig.walking, moving ? 1 : 0, 8.5, delta);
  rig.seated = THREE.MathUtils.damp(rig.seated, seatedAmount, reducedMotion ? 20 : 7, delta);
  const phase = elapsed * 8.1;
  const walk = Math.sin(phase) * 0.62 * rig.walking;
  const sit = rig.seated;
  rig.leftArm.rotation.x = walk * 0.8 - sit * 0.58;
  rig.rightArm.rotation.x = -walk * 0.8 - sit * 0.58;
  rig.leftLeg.rotation.x = -walk * 0.82 - sit * Math.PI / 2;
  rig.rightLeg.rotation.x = walk * 0.82 - sit * Math.PI / 2;
  rig.leftKnee.rotation.x = Math.max(0, -walk) * 0.55 + sit * Math.PI / 2;
  rig.rightKnee.rotation.x = Math.max(0, walk) * 0.55 + sit * Math.PI / 2;
  rig.model.position.y = FLOOR_OFFSET - sit * SEATED_DROP + (reducedMotion ? 0 : Math.abs(Math.sin(phase * 2)) * 0.02 * rig.walking);
  rig.model.rotation.z = Math.sin(phase) * 0.014 * rig.walking;
  rig.shadow.scale.setScalar(THREE.MathUtils.lerp(1, 1.2, sit));
  rig.voiceIndicator.visible = speaking;
  if (speaking && !reducedMotion) rig.voiceIndicator.scale.setScalar(0.9 + Math.sin(elapsed * 13) * 0.16);
  updateBlenderAvatarAnimation(rig, delta);
}

export function disposeAvatar3D(rig: Avatar3DRig) {
  if (rig.disposed) return;
  rig.disposed = true;
  if (rig.blenderAnimation) disposeBlenderAvatarAnimationRig(rig.blenderAnimation);
  rig.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
    if (!isSharedAvatarGeometry(object.geometry)) object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((value) => {
      const candidate = value as THREE.Material & { map?: THREE.Texture };
      if (!isSharedAvatarMaterial(candidate)) {
        candidate.map?.dispose();
        candidate.dispose();
      }
    });
  });
  rig.root.clear();
}
