"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { HousePlayer, NeighborhoodHouse } from "@/lib/types";
import { shouldPublishMovement } from "@/lib/realtimeMovementPolicy.js";
import { dampAngle, resolveStreetPosition, yawToPoint } from "@/lib/streetNavigation.js";
import {
  BAR_DO_PINTO_LAYOUT,
  BAR_DO_PINTO_TABLES,
} from "@/lib/streetBarLayout.js";
import {
  createResidentialLampPosts,
  createResidentialLots,
  RESIDENTIAL_ROADS,
  RESIDENTIAL_SIDEWALKS,
} from "@/lib/streetResidentialLayout.js";
import { EXPANDED_PLAZA_BOUNDS, PLAZA_ACTIVITY_ZONES } from "@/lib/streetPlazaLayout.js";
import {
  SOUND_TRUCK_HORNS,
  SOUND_TRUCK_LAYOUT,
  SOUND_TRUCK_SPEAKERS,
  SOUND_TRUCK_TWEETERS,
} from "@/lib/streetSoundTruckLayout.js";
import { animateAvatar3D, createAvatar3D, disposeAvatar3D, updateAvatar3D, type Avatar3DRig } from "./avatar3d";
import { getAvatarVisualKey } from "./avatarAppearance.js";
import { useCasasGraphics } from "./CasasGraphicsProvider";
import {
  disposeStreetObject,
  disableMicroShadowCasters,
  instanceRepeatedStaticMeshes,
  loadStreetAsset,
  mergeStaticMeshesByMaterial,
  streetBoxGeometry,
  streetStandardMaterial,
} from "./streetResources";
import { createThreePerformanceMonitor } from "@/lib/threePerformanceMonitor";
import { createAvatarRenderBatch } from "./avatar/instancing";

type Props = {
  players: HousePlayer[];
  houses: NeighborhoodHouse[];
  localAvatar?: HousePlayer["avatar"];
  speaking?: boolean;
  onMove: (x: number, y: number, moving: boolean) => void;
  onOpenHouse: (house: NeighborhoodHouse) => void;
  onOpenSoundSystem?: () => void;
  onSoundSystemScreenRect?: (rect: SoundSystemScreenRect | null) => void;
};

export type SoundSystemScreenRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
};

type Seat = { id: string; label: string; position: THREE.Vector3; facing: number };
type StreetObstacle =
  | { kind: "box"; x: number; z: number; width: number; depth: number }
  | { kind: "circle"; x: number; z: number; radius: number };
type FountainJet = { mesh: THREE.Mesh; baseY: number; height: number; phase: number };
type Fountain = { water: THREE.Mesh; jets: FountainJet[] };
type PlazaLife = { mesh: THREE.Mesh; baseY: number; amplitude: number; speed: number; phase: number; scale?: number };
type Plaza = Fountain & { life: PlazaLife[]; soundLeds?: THREE.Mesh[]; soundScreen?: THREE.Mesh };
type AssetScale = readonly [number, number, number];
type Interaction =
  | { kind: "seat"; seat: Seat }
  | { kind: "house"; house: NeighborhoodHouse }
  | { kind: "sound-system" }
  | { kind: "place"; label: string };
type AvatarBillboard = {
  group: THREE.Group;
  rig: Avatar3DRig;
  target: THREE.Vector3;
  nickname: string;
  isMoving: boolean;
  reportedMoving: boolean;
  seatedAmount: number;
  wantsSeated: boolean;
  activeSeat?: Seat;
  pendingSeat?: Seat;
};
type CameraView = "follow" | "plaza" | "village" | "wide";
type Runtime = {
  syncPlayers: () => void;
  toggleSeat: () => void;
  setCameraView: (view: CameraView) => void;
  changeZoom: (amount: number) => void;
};

const WORLD_X = 49;
const WORLD_Z = 71;
const PLAYER_SPEED = 7.2;
const AVATAR_GROUND_Y = 0.025;
const COLORS = {
  night: 0x111529,
  grass: 0x233f35,
  road: 0x252735,
  sidewalk: 0xaaa7ae,
  yellow: 0xf1c84b,
  red: 0xa52f33,
  warm: 0xffd27a,
};
const MERCADINHO_ASSET_URL = "/casas/street/mercadinho-beco.glb";
const BAR_DO_PINTO_ASSET_URL = "/casas/street/bar-do-pinto.glb";
const STREET_LAMP_ASSET_URL = "/casas/street/poste-de-luz-beco.glb";
const PLAZA_BENCH_ASSET_URL = "/casas/street/banco-de-praca-beco.glb";
const PICNIC_TABLE_ASSET_URL = "/casas/street/mesa-de-piquenique-beco.glb";
const TREE_VARIANT_ASSETS = Object.freeze([
  "/casas/street/arvore-copa-redonda-beco.glb",
  "/casas/street/arvore-copa-larga-beco.glb",
  "/casas/street/palmeira-beco.glb",
  "/casas/street/arvore-pinho-beco.glb",
]);
const STREET_ASSET_URLS = Object.freeze([
  MERCADINHO_ASSET_URL,
  BAR_DO_PINTO_ASSET_URL,
  STREET_LAMP_ASSET_URL,
  PLAZA_BENCH_ASSET_URL,
  PICNIC_TABLE_ASSET_URL,
  ...TREE_VARIANT_ASSETS,
]);
const STREET_ASSET_SCALES: Readonly<Record<"bar" | "mercadinho" | "lamp" | "picnicTable" | "tree", AssetScale>> = Object.freeze({
  // The 3D avatar is approximately 3.5 units tall. These scales keep real
  // world landmarks comfortably above a person while preserving their width.
  bar: [1, 1.4, 1],
  mercadinho: [1, 1.8, 1],
  lamp: [1, 2.4, 1],
  picnicTable: [1, 1.18, 1],
  tree: [2, 2, 2],
});
const MAIN_STREET_LAMP_POSTS = Object.freeze([
  Object.freeze({ x: -39, z: -7.4, rotation: Math.PI / 2 }),
  Object.freeze({ x: 39, z: -7.4, rotation: -Math.PI / 2 }),
]);
function cssColor(value: number) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function worldPoint(x: number, y: number) {
  return new THREE.Vector3(
    THREE.MathUtils.lerp(-WORLD_X + 1, WORLD_X - 1, THREE.MathUtils.clamp(x / 100, 0, 1)),
    AVATAR_GROUND_Y,
    THREE.MathUtils.lerp(-WORLD_Z + 1, WORLD_Z - 1, THREE.MathUtils.clamp(y / 100, 0, 1)),
  );
}

function networkPoint(position: THREE.Vector3) {
  return {
    x: Math.round(THREE.MathUtils.clamp((position.x + WORLD_X - 1) / ((WORLD_X - 1) * 2), 0, 1) * 100),
    y: Math.round(THREE.MathUtils.clamp((position.z + WORLD_Z - 1) / ((WORLD_Z - 1) * 2), 0, 1) * 100),
  };
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.closePath();
}

function labelTexture(text: string, foreground = "#fff", background = "rgba(24,21,35,.94)") {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D indisponível para a fachada.");
  roundedRect(context, 8, 8, 1008, 240, 34);
  context.fillStyle = background;
  context.fill();
  context.strokeStyle = "rgba(255,255,255,.22)";
  context.lineWidth = 12;
  context.stroke();
  context.font = "900 104px ui-rounded, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = foreground;
  context.fillText(text, 512, 134, 930);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function standard(color: number, roughness = 0.72, metalness = 0.04) {
  return streetStandardMaterial(color, roughness, metalness);
}

function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material, cast = true) {
  const mesh = new THREE.Mesh(streetBoxGeometry(size), material);
  mesh.position.set(...position);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function planeLabel(parent: THREE.Object3D, text: string, width: number, height: number, position: [number, number, number], foreground?: string, background?: string) {
  const material = new THREE.MeshBasicMaterial({ map: labelTexture(text, foreground, background), transparent: true, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function spriteLabel(parent: THREE.Object3D, text: string, width: number, height: number, position: [number, number, number], foreground?: string, background?: string) {
  const material = new THREE.SpriteMaterial({ map: labelTexture(text, foreground, background), transparent: true, depthTest: true, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  sprite.position.set(...position);
  parent.add(sprite);
  return sprite;
}

function attachInteraction(object: THREE.Object3D, interaction: Interaction) {
  object.userData.interaction = interaction;
}

function invisibleHit(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], interaction: Interaction) {
  const hit = box(parent, size, position, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), false);
  hit.receiveShadow = false;
  attachInteraction(hit, interaction);
}

function appendStreetAsset(parent: THREE.Group, assetUrl: string, errorMessage: string, rotation = 0, scale: AssetScale = [1, 1, 1]) {
  void loadStreetAsset(assetUrl)
    .then(model => {
      if (parent.userData.disposed) return;
      const asset = model.clone(true);
      asset.rotation.y = rotation;
      asset.scale.set(...scale);
      asset.traverse(object => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          object.castShadow = materials.some((material) => {
            const standardMaterial = material as THREE.MeshStandardMaterial;
            return !material.transparent && material.opacity >= .98 && (standardMaterial.emissiveIntensity || 0) < 1.25;
          });
          object.receiveShadow = true;
        }
      });
      parent.add(asset);
    })
    .catch(error => console.warn(errorMessage, error));
}

function addLamp(scene: THREE.Scene, x: number, z: number, night: boolean, rotation = 0) {
  const group = new THREE.Group();
  group.name = "Poste de luz do beco";
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  scene.add(group);
  appendStreetAsset(group, STREET_LAMP_ASSET_URL, "Não foi possível carregar o modelo do poste de luz.", 0, STREET_ASSET_SCALES.lamp);
  if (night) {
    const light = new THREE.PointLight(COLORS.warm, 7.5, 15, 2);
    light.position.set(.72, 9.8, 0);
    group.add(light);
  }
}

function addTree(scene: THREE.Scene, x: number, z: number, obstacles: StreetObstacle[], scale = 1) {
  const group = new THREE.Group();
  const variantIndex = Math.abs(Math.round(x * 17 + z * 29)) % TREE_VARIANT_ASSETS.length;
  const variantNames = ["Árvore de copa redonda", "Árvore de copa larga", "Palmeira", "Pinheiro"];
  group.name = variantNames[variantIndex];
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  scene.add(group);
  appendStreetAsset(group, TREE_VARIANT_ASSETS[variantIndex], "Não foi possível carregar uma variante de árvore.", 0, STREET_ASSET_SCALES.tree);
  obstacles.push({ kind: "circle", x, z, radius: .86 * scale });
}

function addBench(parent: THREE.Object3D, id: string, x: number, z: number, label: string, seats: Seat[], rotation = 0) {
  const group = new THREE.Group();
  group.name = "Banco de praça";
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  const seat = { id, label, position: new THREE.Vector3(), facing: rotation };
  seats.push(seat);
  invisibleHit(group, [3.2, 1.4, 1.25], [0, 1.05, 0], { kind: "seat", seat });
  parent.add(group);
  // Blender's depth axis is opposite to the legacy bench geometry. Rotating only
  // the visual asset preserves every existing seat coordinate and facing.
  appendStreetAsset(group, PLAZA_BENCH_ASSET_URL, "Não foi possível carregar o modelo do banco da praça.", Math.PI);
  parent.updateMatrixWorld(true);
  seat.position.set(0, AVATAR_GROUND_Y, -0.02).applyMatrix4(group.matrixWorld);
}

function addBenchFacing(parent: THREE.Object3D, id: string, x: number, z: number, label: string, seats: Seat[], targetX: number, targetZ: number) {
  const rotation = Math.atan2(targetX - x, targetZ - z);
  addBench(parent, id, x, z, label, seats, rotation);
}

function addChair(parent: THREE.Object3D, id: string, x: number, z: number, label: string, seats: Seat[], rotation = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  const plastic = standard(0x322c34, 0.65);
  box(group, [0.95, 0.13, 0.95], [0, 0.62, 0], plastic);
  [-0.38, 0.38].forEach(px => [-0.36, 0.36].forEach(pz => box(group, [0.09, 0.62, 0.09], [px, 0.31, pz], plastic)));
  box(group, [0.95, 1.05, 0.12], [0, 1.15, -0.43], plastic);
  const seat = { id, label, position: new THREE.Vector3(), facing: rotation };
  seats.push(seat);
  invisibleHit(group, [1.15, 1.6, 1.15], [0, 1, 0], { kind: "seat", seat });
  parent.add(group);
  parent.updateMatrixWorld(true);
  seat.position.set(0, AVATAR_GROUND_Y, 0).applyMatrix4(group.matrixWorld);
}

function addPicnicTable(parent: THREE.Object3D, id: string, x: number, z: number, seats: Seat[], rotation = 0) {
  const group = new THREE.Group();
  group.name = "Mesa de piquenique";
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  parent.add(group);
  const picnicSeats: Seat[] = [];
  [-1.16, 1.16].forEach(pz => {
    const facing = rotation + (pz < 0 ? 0 : Math.PI);
    const seat: Seat = { id: `${id}-${pz < 0 ? "norte" : "sul"}`, label: "banco da mesa de piquenique", position: new THREE.Vector3(), facing };
    seats.push(seat);
    picnicSeats.push(seat);
    invisibleHit(group, [4.25, 1.35, .78], [0, .7, pz], { kind: "seat", seat });
    parent.updateMatrixWorld(true);
    seat.position.set(0, AVATAR_GROUND_Y, pz).applyMatrix4(group.matrixWorld);
  });
  attachInteraction(group, { kind: "seat", seat: picnicSeats[0]! });
  appendStreetAsset(group, PICNIC_TABLE_ASSET_URL, "Não foi possível carregar o modelo da mesa de piquenique.", 0, STREET_ASSET_SCALES.picnicTable);
}

function addVendorStall(parent: THREE.Group, id: string, x: number, z: number, title: string, accent: number, product: "popcorn" | "hotdog" | "juice", obstacles: StreetObstacle[], life: PlazaLife[], night: boolean) {
  const stall = new THREE.Group();
  stall.position.set(x, 0, z);
  // A vendor can stand under the awning with comfortable clearance.
  stall.scale.y = 1.2;
  const cream = standard(0xf7e7c1, 0.74);
  const accentMaterial = standard(accent, 0.54, 0.14);
  box(stall, [4.1, 1.25, 2.15], [0, .66, 0], cream);
  box(stall, [4.25, .24, 2.28], [0, 1.36, 0], accentMaterial);
  [-1.76, 1.76].forEach(px => {
    box(stall, [.13, 3.7, .13], [px, 2.2, 0], standard(0x41313a, .45, .35));
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .16, 14), standard(0x25242d, .52));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(px, .32, -1.02);
    stall.add(wheel);
  });
  for (let stripe = -1.8; stripe <= 1.8; stripe += .6) box(stall, [.32, .16, 2.55], [stripe, 3.8, 0], stripe % 1.2 === 0 ? accentMaterial : cream);
  box(stall, [4.15, .16, 2.55], [0, 3.68, 0], accentMaterial);
  planeLabel(stall, title, 3.2, .72, [0, 2.6, 1.12], "#fffdf3", cssColor(accent));
  const vendorBody = new THREE.Mesh(new THREE.CylinderGeometry(.44, .54, 1.1, 14), standard(0x4d73a6, .64));
  vendorBody.position.set(0, 2, -.45);
  vendorBody.castShadow = true;
  stall.add(vendorBody);
  const vendorHead = new THREE.Mesh(new THREE.SphereGeometry(.43, 16, 12), standard(0x7e4d37, .8));
  vendorHead.position.set(0, 2.78, -.45);
  vendorHead.castShadow = true;
  stall.add(vendorHead);
  box(stall, [1.15, .16, .54], [0, 1.65, .78], standard(0x3a2d35, .48));
  if (product === "popcorn") {
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(.34, .42, .42, 16), accentMaterial);
    bucket.position.set(-.9, 1.92, .72);
    stall.add(bucket);
    [[-.99, 2.23], [-.82, 2.22], [-.9, 2.32], [-1.07, 2.29]].forEach(([px, py]) => {
      const kernel = new THREE.Mesh(new THREE.SphereGeometry(.15, 10, 8), standard(0xffed91, .74));
      kernel.position.set(px, py, .72);
      stall.add(kernel);
    });
  } else if (product === "hotdog") {
    const bread = new THREE.Mesh(new THREE.CapsuleGeometry(.18, .72, 6, 12), standard(0xe5a55e, .84));
    bread.rotation.z = Math.PI / 2;
    bread.position.set(-.86, 1.94, .72);
    stall.add(bread);
    const sausage = new THREE.Mesh(new THREE.CapsuleGeometry(.07, .64, 6, 10), standard(0xa54134, .7));
    sausage.rotation.z = Math.PI / 2;
    sausage.position.set(-.86, 2.12, .72);
    stall.add(sausage);
  } else {
    [-1.1, -.7].forEach(px => {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, .48, 12), standard(0x8fd8a9, .38, .1));
      cup.position.set(px, 1.9, .72);
      stall.add(cup);
    });
  }
  const steamMaterial = new THREE.MeshBasicMaterial({ color: product === "hotdog" ? 0xffead0 : 0xfff2ba, transparent: true, opacity: .38, depthWrite: false });
  for (let puff = 0; puff < 3; puff += 1) {
    const steam = new THREE.Mesh(new THREE.SphereGeometry(.18 + puff * .035, 10, 8), steamMaterial);
    steam.position.set(-.55 + puff * .28, 2.28 + puff * .32, .48);
    stall.add(steam);
    life.push({ mesh: steam, baseY: steam.position.y, amplitude: .3 + puff * .04, speed: 1.15 + puff * .15, phase: puff * 1.7, scale: 1 + puff * .12 });
  }
  if (night) {
    const lamp = new THREE.PointLight(0xffd47d, 3.4, 6, 2);
    lamp.position.set(0, 3.35, 1.1);
    stall.add(lamp);
  }
  invisibleHit(stall, [4.35, 4.1, 2.8], [0, 2, 0], { kind: "place", label: `${title} — barraquinha da Praça do Beco` });
  parent.add(stall);
  obstacles.push({ kind: "box", x: parent.position.x + x, z: parent.position.z + z, width: 4.35, depth: 2.8 });
}

function addFestoonLights(parent: THREE.Group, life: PlazaLife[], night: boolean) {
  const poleMaterial = standard(0x302b38, .38, .62);
  [[-10, -9.4], [10, -9.4], [-10, 9.4], [10, 9.4]].forEach(([x, z]) => box(parent, [.16, 5.15, .16], [x, 2.57, z], poleMaterial));
  [-9.4, 9.4].forEach(z => {
    box(parent, [20.2, .07, .07], [0, 4.72, z], poleMaterial);
    for (let x = -8.3; x <= 8.3; x += 1.65) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffd773, emissive: 0xffc457, emissiveIntensity: night ? 2.8 : .5 }));
      bulb.position.set(x, 4.57 - .16 * Math.cos(x * .8), z);
      parent.add(bulb);
      life.push({ mesh: bulb, baseY: bulb.position.y, amplitude: .04, speed: 1.55, phase: x + z, scale: 1 });
    }
  });
}

function addBalloonBunch(parent: THREE.Group, x: number, z: number, colors: number[], life: PlazaLife[]) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  colors.forEach((color, index) => {
    const balloon = new THREE.Mesh(new THREE.SphereGeometry(.34, 14, 10), new THREE.MeshStandardMaterial({ color, roughness: .38, metalness: .08 }));
    balloon.position.set((index - 1) * .31, 2.5 + (index % 2) * .22, (index % 2 - .5) * .16);
    balloon.scale.y = 1.18;
    balloon.castShadow = true;
    group.add(balloon);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.35, 6), standard(0xeee1ca, .7));
    string.position.set(balloon.position.x, 1.72, balloon.position.z);
    group.add(string);
    life.push({ mesh: balloon, baseY: balloon.position.y, amplitude: .18, speed: 1.25 + index * .14, phase: index * 1.4 + x, scale: 1 });
  });
  parent.add(group);
}

function addPlaza(scene: THREE.Scene, seats: Seat[], obstacles: StreetObstacle[], night: boolean): Plaza {
  const plaza = new THREE.Group();
  plaza.position.set(0, 0, 20);
  const paving = standard(0xd3c5b1, .92);
  box(plaza, [3.35, .06, 18.9], [0, .35, 0], paving);
  box(plaza, [18.5, .06, 3.1], [0, .36, 0], paving);
  [[-7.25, -2.4], [7.25, -2.4], [-7.25, 3.3], [7.25, 3.3]].forEach(([x, z]) => {
    const tile = new THREE.Mesh(new THREE.CircleGeometry(1.28, 16), standard(0xbead95, .9));
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(x, .39, z);
    plaza.add(tile);
  });
  const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.8, .72, 48), standard(0x726c7c, .55));
  fountainBase.position.y = .66;
  fountainBase.castShadow = fountainBase.receiveShadow = true;
  plaza.add(fountainBase);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.18, 2.18, .14, 48), new THREE.MeshPhysicalMaterial({ color: 0x4f93b8, metalness: .12, roughness: .16, transmission: .12, clearcoat: 1, clearcoatRoughness: .12, transparent: true, opacity: .9 }));
  water.position.y = 1.06;
  plaza.add(water);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(.34, .58, 2.8, 18), standard(0x87818f, .52));
  column.position.y = 2.15;
  column.castShadow = true;
  plaza.add(column);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(1.08, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), standard(0x87818f, .48));
  bowl.rotation.x = Math.PI;
  bowl.position.y = 3.55;
  plaza.add(bowl);
  const jetMaterial = new THREE.MeshPhysicalMaterial({ color: 0x9eeaff, emissive: 0x4aaee5, emissiveIntensity: .9, transparent: true, opacity: .8, roughness: .08, transmission: .15 });
  const jets: FountainJet[] = [];
  const life: PlazaLife[] = [];
  const jetSpecs: Array<[number, number, number, number]> = [[0, 0, 2.55, 0], [.82, .18, 1.55, .8], [-.72, -.22, 1.72, 1.7], [.28, -.86, 1.42, 2.5], [-.24, .82, 1.3, 3.2]];
  jetSpecs.forEach(([x, z, height, phase]) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.045, .1, 1, 10), jetMaterial);
    mesh.castShadow = true;
    mesh.position.set(x, 1.1 + height / 2, z);
    plaza.add(mesh);
    jets.push({ mesh, baseY: 1.1, height, phase });
  });
  addVendorStall(plaza, "pipoca", -7.3, -6.4, "PIPOCA", 0xd44343, "popcorn", obstacles, life, night);
  addVendorStall(plaza, "cachorro-quente", 7.3, -6.4, "CACHORRO-QUENTE", 0xe08535, "hotdog", obstacles, life, night);
  addVendorStall(plaza, "caldo-de-cana", 0, 8.1, "CALDO DE CANA", 0x4a9675, "juice", obstacles, life, night);
  addPicnicTable(plaza, "piquenique-oeste", -7.05, 2.8, seats, -Math.PI / 14);
  addPicnicTable(plaza, "piquenique-leste", 7.05, 2.8, seats, Math.PI / 14);
  addBenchFacing(plaza, "praca-fonte-norte", 0, -4.45, "banco da fonte", seats, 0, 0);
  addBenchFacing(plaza, "praca-fonte-sul", 0, 4.45, "banco da fonte", seats, 0, 0);
  addBenchFacing(plaza, "praca-fonte-oeste", -4.6, 0, "banco da fonte", seats, 0, 0);
  addBenchFacing(plaza, "praca-fonte-leste", 4.6, 0, "banco da fonte", seats, 0, 0);
  addBenchFacing(plaza, "praca-feirinha-oeste", -9.2, .2, "banco da barraca de pipoca", seats, -7.3, -6.4);
  addBenchFacing(plaza, "praca-feirinha-leste", 9.2, .2, "banco da barraca de cachorro-quente", seats, 7.3, -6.4);
  addFestoonLights(plaza, life, night);
  const gateMaterial = standard(0x5b4558, .42, .42);
  [-2.9, 2.9].forEach(x => box(plaza, [.2, 4.8, .2], [x, 2.42, -10.15], gateMaterial));
  box(plaza, [6.05, .22, .2], [0, 4.72, -10.15], gateMaterial);
  planeLabel(plaza, "FEIRINHA DO BECO", 5.7, .82, [0, 4.15, -10.04], "#fff6dc", "#68445e");
  addBalloonBunch(plaza, -10, -3.1, [0xf4c85e, 0xdf5a63, 0x7fa9e6], life);
  addBalloonBunch(plaza, 10, 5.6, [0x9fe0b5, 0xf1a25d, 0xc989dc], life);
  scene.add(plaza);
  obstacles.push({ kind: "circle", x: plaza.position.x, z: plaza.position.z, radius: 3.35 });
  return { water, jets, life };
}

function addBar(scene: THREE.Scene, seats: Seat[], obstacles: StreetObstacle[], night: boolean) {
  const bar = new THREE.Group();
  bar.name = "Bar do Pinto";
  bar.position.set(BAR_DO_PINTO_LAYOUT.centerX, 0, BAR_DO_PINTO_LAYOUT.centerZ);
  attachInteraction(bar, { kind: "place", label: "Bar do Pinto — mesas, Pitú e o pinto no ovo" });
  scene.add(bar);
  appendStreetAsset(bar, BAR_DO_PINTO_ASSET_URL, "Não foi possível carregar o modelo do Bar do Pinto.", 0, STREET_ASSET_SCALES.bar);

  if (night) {
    [-5.6, -1.9, 1.9, 5.6].forEach(x => {
      const light = new THREE.PointLight(0xffcc7a, 5.5, 7, 2);
      light.position.set(x, 4.55, 4.9);
      bar.add(light);
    });
  }

  const tableMaterial = standard(0x2c2830, 0.58);
  BAR_DO_PINTO_TABLES.forEach(({ x, z }, tableIndex) => {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.14, 24), tableMaterial);
    top.position.set(x, 1.05, z); top.castShadow = true; bar.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.19, 1.05, 12), tableMaterial);
    leg.position.set(x, 0.52, z); leg.castShadow = true; bar.add(leg);
    addChair(bar, `bar-${tableIndex}-esquerda`, x - 1.35, z, "cadeira à esquerda da mesa", seats, Math.PI / 2);
    addChair(bar, `bar-${tableIndex}-direita`, x + 1.35, z, "cadeira à direita da mesa", seats, -Math.PI / 2);
    addChair(bar, `bar-${tableIndex}-frente`, x, z + 1.08, "cadeira em frente à mesa", seats, Math.PI);
  });
  box(bar, [.8, 3.25, 4.8], [7.35, 1.63, 1.1], standard(0x77746f, .98));
  [-7.0, -6.55, -6.15, -5.72].forEach((x, index) => {
    const root = box(bar, [1.55 - index * .12, .18, .38], [x, .13, 4.55 + index * .3], standard(0x604735, .96));
    root.rotation.y = -.34 + index * .18;
  });
  obstacles.push({ kind: "box", x: BAR_DO_PINTO_LAYOUT.centerX, z: BAR_DO_PINTO_LAYOUT.centerZ, width: BAR_DO_PINTO_LAYOUT.width, depth: BAR_DO_PINTO_LAYOUT.depth });
}

function addSoundSystem(scene: THREE.Scene, obstacles: StreetObstacle[], night: boolean) {
  const installation = new THREE.Group();
  installation.position.set(-0.4, 0, -9.1);
  const leds: THREE.Mesh[] = [];
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f1, roughness: .2, metalness: .24, clearcoat: 1, clearcoatRoughness: .11 });
  const bumper = standard(0x282a31, .28, .72);
  const tireMaterial = standard(0x101116, .74, .2);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x7ca8bd, roughness: .08, metalness: .2, transparent: true, opacity: .76, clearcoat: 1 });
  const magenta = standard(0xd72aa8, .32, .28);
  const cabinetWhite = standard(0xf4f1ef, .34, .2);
  const cabinetBlue = standard(0x253b71, .38, .3);

  const truck = new THREE.Group();
  truck.rotation.y = -0.06;
  installation.add(truck);
  box(truck, [SOUND_TRUCK_LAYOUT.length, .52, SOUND_TRUCK_LAYOUT.width], [0, .72, 0], paint);
  box(truck, [1.62, .58, 2.38], [-2.42, 1.17, 0], paint);
  box(truck, [2.02, 1.46, 2.28], [-1.12, 1.66, 0], paint);
  box(truck, [1.78, .18, 2.32], [-1.08, 2.43, 0], paint);
  box(truck, [2.2, .18, 2.35], [1.5, 1.08, 0], bumper);
  box(truck, [.16, .48, 2.4], [3.08, 1.03, 0], paint);
  box(truck, [.22, .28, 2.5], [-3.14, .84, 0], bumper);
  box(truck, [.22, .28, 2.5], [3.18, .82, 0], standard(0xc7c9c8, .3, .68));

  [-1.55, -.65].forEach((windowX) => {
    const sideWindow = box(truck, [.78, .74, .08], [windowX, 1.96, 1.17], glass);
    sideWindow.rotation.z = windowX < -1 ? -.08 : 0;
  });
  box(truck, [.08, .86, 2.04], [-.11, 1.88, 0], glass);
  box(truck, [.055, 1.32, 2.33], [-.22, 1.52, 0], bumper);
  box(truck, [.055, 1.3, 2.31], [-2.07, 1.5, 0], bumper);
  box(truck, [.44, .1, .1], [-.75, 1.61, 1.24], bumper);
  [-2.07, -.15].forEach((x) => box(truck, [.12, .1, .25], [x, 1.83, 1.3], bumper));
  const mirror = box(truck, [.28, .24, .18], [-2.03, 1.96, 1.38], bumper);
  mirror.rotation.z = -.18;

  [-2.12, 2.08].forEach((wheelX) => [-1.26, 1.26].forEach((wheelZ) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.61, .61, .38, 28), tireMaterial);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wheelX, .58, wheelZ);
    wheel.castShadow = true;
    truck.add(wheel);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .4, 20), standard(0xc8cbd0, .2, .82));
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(wheel.position);
    truck.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .42, 16), bumper);
    hub.rotation.x = Math.PI / 2;
    hub.position.copy(wheel.position);
    truck.add(hub);
  }));
  [-2.72, -2.35].forEach((x) => box(truck, [.3, .24, .1], [x, 1.28, 1.22], new THREE.MeshStandardMaterial({ color: 0xe8fbff, emissive: 0xbceaff, emissiveIntensity: night ? 2.4 : .5 })));
  box(truck, [.72, .28, .1], [2.77, 1.03, 1.22], new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff173e, emissiveIntensity: night ? 2.8 : .6 }));

  const tailgate = new THREE.Group();
  tailgate.position.set(1.5, .67, 1.62);
  tailgate.rotation.x = -.08;
  box(tailgate, [3.05, .14, 1.18], [0, 0, .42], standard(0x2b5fba, .34, .46));
  for (let groove = -1.25; groove <= 1.25; groove += .42) box(tailgate, [.06, .04, 1.05], [groove, .09, .42], standard(0x6ea8ff, .3, .34), false);
  truck.add(tailgate);

  const wall = new THREE.Group();
  wall.position.set(SOUND_TRUCK_LAYOUT.wallX, SOUND_TRUCK_LAYOUT.wallY, -.02);
  truck.add(wall);
  box(wall, [SOUND_TRUCK_LAYOUT.wallWidth, SOUND_TRUCK_LAYOUT.wallHeight, .62], [0, 0, 0], cabinetWhite);
  box(wall, [3.58, 3.92, .16], [0, 0, .4], magenta);
  box(wall, [3.32, 3.66, .12], [0, 0, .5], cabinetWhite);
  [-2.04, 2.04].forEach((x) => {
    box(wall, [1.02, 3.12, .2], [x, .57, .43], magenta);
    box(wall, [.8, 2.86, .1], [x, .57, .56], cabinetWhite);
  });
  box(wall, [2.25, 1.7, .12], [0, -1.15, .57], cabinetBlue);

  const addSpeaker = (x: number, y: number, radius: number, color: number) => {
    const ringMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: night ? 3.8 : 1.4, roughness: .32 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * .16, 12, 32), ringMaterial);
    ring.position.set(x, y, .65);
    wall.add(ring);
    leds.push(ring);
    const cone = new THREE.Mesh(new THREE.CircleGeometry(radius * .78, 32), standard(0x10131d, .3, .28));
    cone.position.set(x, y, .635);
    wall.add(cone);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(radius * .29, 24), standard(0x27304a, .22, .58));
    cap.position.set(x, y, .675);
    wall.add(cap);
  };
  SOUND_TRUCK_SPEAKERS.forEach((speaker) => addSpeaker(speaker.x, speaker.y, speaker.radius, speaker.color));

  SOUND_TRUCK_TWEETERS.forEach((tweeter, index) => {
    const color = index < 2 ? 0x52dcff : 0xf34bdf;
    addSpeaker(tweeter.x, tweeter.y, .15, color);
  });

  SOUND_TRUCK_HORNS.forEach((horn, index) => {
    const enclosure = new THREE.Group();
    enclosure.position.set(horn.x, horn.y, .62);
    box(enclosure, [.65, .85, .12], [0, 0, 0], cabinetWhite);
    const hornMaterial = new THREE.MeshStandardMaterial({ color: index % 2 ? 0x3b70cf : 0x2758ae, emissive: 0x1d67d8, emissiveIntensity: night ? 1.7 : .45, roughness: .38 });
    const hornFace = box(enclosure, [.49, .6, .08], [0, 0, .1], hornMaterial);
    hornFace.scale.set(1, .76, 1);
    wall.add(enclosure);
    leds.push(hornFace);
  });

  [-1, 1].forEach((side) => {
    const diagonal = box(wall, [1.7, .08, .07], [side * .82, -1.17, .7], new THREE.MeshStandardMaterial({ color: side < 0 ? 0x4ca7ff : 0x52f3cf, emissive: side < 0 ? 0x226bd5 : 0x18a981, emissiveIntensity: night ? 2.2 : .65 }), false);
    diagonal.rotation.z = side * .78;
    leds.push(diagonal);
  });
  box(wall, [4.72, .12, .12], [0, 2.02, .48], magenta);
  planeLabel(wall, "PAREDÃO DO BECO", 3.2, .45, [0, 2.02, .65], "#ffffff", "#a81f92");

  const frameMaterial = standard(0xd8dde0, .3, .66);
  [-1.7, 0, 1.7].forEach((x) => box(truck, [.1, 2.1, .1], [SOUND_TRUCK_LAYOUT.wallX + x, 2.05, -.31], frameMaterial));
  box(truck, [4.8, .1, .1], [SOUND_TRUCK_LAYOUT.wallX, 1.08, -.31], frameMaterial);
  invisibleHit(truck, [6.7, 5.6, 3.2], [0, 2.65, 0], { kind: "sound-system" });

  const tv = new THREE.Group();
  tv.position.set(5.25, 0, -.15);
  tv.rotation.y = -.08;
  installation.add(tv);
  box(tv, [.18, 2.35, .18], [0, 1.18, 0], bumper);
  box(tv, [2.1, .16, 1.05], [0, .12, 0], bumper);
  const bezel = box(tv, [4.05, 2.48, .28], [0, 3.05, 0], standard(0x111218, .28, .66));
  const screenMaterial = new THREE.MeshStandardMaterial({ color: 0x15102c, emissive: 0x5d1f92, emissiveIntensity: night ? 1.9 : .75, roughness: .18, metalness: .08 });
  const screen = box(tv, [3.72, 2.1, .08], [0, 3.05, .2], screenMaterial);
  planeLabel(tv, "YOUTUBE · 43\"", 2.9, .46, [0, 3.05, .255], "#ffffff", "#4b1974");
  attachInteraction(bezel, { kind: "sound-system" });
  attachInteraction(screen, { kind: "sound-system" });
  leds.push(screen);

  scene.add(installation);
  obstacles.push({ kind: "box", x: -.4, z: -9.1, width: 6.7, depth: 3.2 });
  obstacles.push({ kind: "box", x: 4.85, z: -9.25, width: 4.4, depth: 1.3 });
  return { leds, screen };
}

function addProperty(scene: THREE.Scene, x: number, title: string, palette: [number, number], night: boolean, interaction: Interaction, obstacles: StreetObstacle[], width = 7, z = -12.3) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  // Storefronts share the same door and facade scale as resident houses.
  group.scale.y = 1.55;
  const body = box(group, [width, 4.8, 3.7], [0, 2.4, 0], standard(palette[0], 0.82));
  box(group, [width + 0.35, 0.35, 4.1], [0, 4.95, 0], standard(palette[1], 0.48, 0.32));
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0xffd785, emissive: 0xffb74e, emissiveIntensity: night ? 1.35 : 0.2, roughness: 0.36 });
  box(group, [1.45, 1.45, 0.16], [-1.9, 2.4, 1.92], windowMaterial);
  box(group, [1.45, 1.45, 0.16], [1.9, 2.4, 1.92], windowMaterial);
  box(group, [1.15, 2.4, 0.18], [0, 1.25, 1.94], standard(0x453542, 0.65));
  planeLabel(group, title, width * 0.72, 0.78, [0, 4.1, 1.95], "#fff", cssColor(palette[1]));
  attachInteraction(body, interaction);
  scene.add(group);
  obstacles.push({ kind: "box", x, z, width, depth: 3.7 });
  return group;
}

function addMercadinho(scene: THREE.Scene, obstacles: StreetObstacle[]) {
  const mercadinho = new THREE.Group();
  mercadinho.name = "Mercadinho do Beco";
  mercadinho.position.set(23.5, 0, -12.3);
  attachInteraction(mercadinho, { kind: "place", label: "Mercadinho do Beco — porta, vitrines e feira fresca" });
  scene.add(mercadinho);
  appendStreetAsset(mercadinho, MERCADINHO_ASSET_URL, "Não foi possível carregar o modelo do mercadinho.", 0, STREET_ASSET_SCALES.mercadinho);

  obstacles.push({ kind: "box", x: 23.5, z: -12.3, width: 9.5, depth: 4.35 });
}

const RESIDENT_PALETTES: Array<[number, number, number]> = [
  [0x755f82, 0x392d4c, 0xe7bf6a],
  [0x50786f, 0x294b45, 0x8ed6bb],
  [0x896b4f, 0x4d382b, 0xf0ad67],
  [0x5c6f91, 0x303d5a, 0x9fbcea],
  [0x895d67, 0x50343d, 0xe998a9],
];

function addGroundRect(scene: THREE.Scene, width: number, depth: number, x: number, z: number, material: THREE.Material, y = .045) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  mesh.userData.ground = true;
  scene.add(mesh);
  return mesh;
}

function addFlowerBed(parent: THREE.Object3D, x: number, z: number, width: number, accent: number) {
  const bed = new THREE.Group();
  bed.position.set(x, 0, z);
  box(bed, [width, .32, 1.35], [0, .18, 0], standard(0x6d4b36, .96));
  box(bed, [width + .2, .16, 1.55], [0, .08, 0], standard(0xb7a58b, .9));
  for (let offset = -width / 2 + .45, index = 0; offset <= width / 2 - .35; offset += .72, index += 1) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.025, .035, .5, 6), standard(0x4f8b5d, .9));
    stem.position.set(offset, .62, (index % 2 ? .24 : -.2));
    bed.add(stem);
    const flower = new THREE.Mesh(new THREE.DodecahedronGeometry(.15, 0), standard(index % 3 ? accent : 0xffd66e, .58));
    flower.position.set(offset, .91, stem.position.z);
    flower.castShadow = true;
    bed.add(flower);
  }
  parent.add(bed);
}

function addBasketHoop(parent: THREE.Object3D, z: number, facing: number, obstacles: StreetObstacle[], worldX: number, worldZ: number) {
  const hoop = new THREE.Group();
  hoop.position.set(0, 0, z);
  hoop.rotation.y = facing;
  // Official rim height is about 1.74 avatar-heights in this world.
  hoop.scale.y = 2.1;
  box(hoop, [.16, 3.5, .16], [0, 1.75, .62], standard(0x34313c, .3, .72));
  box(hoop, [2.15, 1.15, .18], [0, 3.45, .35], standard(0xe8e3db, .54));
  box(hoop, [1.78, .08, .2], [0, 3.45, .23], standard(0x574963, .5));
  box(hoop, [.08, .82, .2], [0, 3.45, .23], standard(0x574963, .5));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.42, .065, 10, 24), new THREE.MeshStandardMaterial({ color: 0xe46b3f, emissive: 0x9d301e, emissiveIntensity: .24, roughness: .42 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 2.9, -.18);
  hoop.add(rim);
  parent.add(hoop);
  obstacles.push({ kind: "circle", x: worldX, z: worldZ + z, radius: .55 });
}

function addExpandedPlaza(scene: THREE.Scene, seats: Seat[], obstacles: StreetObstacle[], night: boolean) {
  const park = new THREE.Group();
  const width = EXPANDED_PLAZA_BOUNDS.maxX - EXPANDED_PLAZA_BOUNDS.minX;
  const depth = EXPANDED_PLAZA_BOUNDS.maxZ - EXPANDED_PLAZA_BOUNDS.minZ;
  const centerZ = (EXPANDED_PLAZA_BOUNDS.minZ + EXPANDED_PLAZA_BOUNDS.maxZ) / 2;
  const parkPaving = new THREE.MeshStandardMaterial({ color: 0xbcb8bf, emissive: 0x333039, emissiveIntensity: night ? .14 : 0, roughness: .94 });
  const path = standard(0xc8bca9, .94);
  const border = standard(0xa49ca7, .9);
  const parkBase = addGroundRect(scene, width, depth, 0, centerZ, parkPaving, .052);
  attachInteraction(parkBase, { kind: "place", label: "Praça do Beco — parque, jardim e quadra comunitária" });
  const pavingJoint = new THREE.MeshBasicMaterial({ color: 0x625e69, transparent: true, opacity: .34 });
  for (let x = EXPANDED_PLAZA_BOUNDS.minX + 3; x < EXPANDED_PLAZA_BOUNDS.maxX; x += 5) {
    addGroundRect(scene, .055, depth - .8, x, centerZ, pavingJoint, .061);
  }
  for (let z = EXPANDED_PLAZA_BOUNDS.minZ + 3; z < EXPANDED_PLAZA_BOUNDS.maxZ; z += 4.25) {
    addGroundRect(scene, width - .8, .055, 0, z, pavingJoint, .061);
  }

  addGroundRect(scene, width, 2.5, 0, EXPANDED_PLAZA_BOUNDS.minZ + 1.25, border, .073);
  addGroundRect(scene, width, 2.5, 0, EXPANDED_PLAZA_BOUNDS.maxZ - 1.25, border, .073);
  addGroundRect(scene, 2.5, depth, EXPANDED_PLAZA_BOUNDS.minX + 1.25, centerZ, border, .073);
  addGroundRect(scene, 2.5, depth, EXPANDED_PLAZA_BOUNDS.maxX - 1.25, centerZ, border, .073);
  addGroundRect(scene, 5.2, depth - 2.5, 0, centerZ, path, .082);
  // This connector overlaps the garden/court edge; keep it beneath their
  // dedicated surfaces so depth testing never makes the court flicker.
  addGroundRect(scene, width - 4.5, 3.2, 0, 32.2, path, .064);

  // Side recantos spread activity across the paved square while preserving a
  // generous central circulation route to the fountain and vendors.
  addFlowerBed(park, -18.6, 11.6, 8.2, 0xe77f9e);
  addFlowerBed(park, 18.6, 11.6, 8.2, 0x7bb7e2);
  addPicnicTable(park, "pracinha-lateral-oeste", -18, 24.8, seats, Math.PI / 2);
  addPicnicTable(park, "pracinha-lateral-leste", 18, 24.8, seats, Math.PI / 2);
  addBenchFacing(park, "pracinha-banco-oeste", -23.2, 25.1, "banco do recanto oeste", seats, -18, 24.8);
  addBenchFacing(park, "pracinha-banco-leste", 23.2, 25.1, "banco do recanto leste", seats, 18, 24.8);
  addTree(scene, -24.2, 17.3, obstacles, .66);
  addTree(scene, 24.2, 17.3, obstacles, .66);

  const picnic = PLAZA_ACTIVITY_ZONES.find((zone) => zone.id === "picnic-garden")!;
  const gardenSurface = addGroundRect(scene, picnic.width, picnic.depth, picnic.x, picnic.z, standard(0x355d47, .98), .078);
  attachInteraction(gardenSurface, { kind: "place", label: "Jardim do Beco — mesas, flores e sombra" });
  addPicnicTable(park, "jardim-piquenique-1", picnic.x - 2.7, picnic.z - 1.8, seats, Math.PI / 2);
  addPicnicTable(park, "jardim-piquenique-2", picnic.x + 2.7, picnic.z + 2.2, seats, Math.PI / 2);
  addBenchFacing(park, "jardim-banco-oeste", picnic.x - 7.2, picnic.z, "banco do jardim", seats, picnic.x, picnic.z);
  addBenchFacing(park, "jardim-banco-sul", picnic.x, picnic.z + 7.1, "banco das flores", seats, picnic.x, picnic.z);
  addFlowerBed(park, picnic.x - 4.9, picnic.z - 6.2, 5.6, 0xe77f9e);
  addFlowerBed(park, picnic.x + 4.5, picnic.z - 6.2, 4.7, 0x9d8ee7);
  const gardenSign = new THREE.Group();
  gardenSign.position.set(picnic.x, 0, picnic.z - picnic.depth / 2 + .45);
  box(gardenSign, [5.7, 1.45, .18], [0, 1.15, 0], standard(0x5a4437, .62));
  planeLabel(gardenSign, "JARDIM DO BECO", 5.15, .8, [0, 1.18, .11], "#fff4dc", "#5d4939");
  park.add(gardenSign);

  const court = PLAZA_ACTIVITY_ZONES.find((zone) => zone.id === "community-court")!;
  const courtSurface = addGroundRect(scene, court.width, court.depth, court.x, court.z, standard(0x4b6572, .78), .082);
  attachInteraction(courtSurface, { kind: "place", label: "Quadra do Beco — basquete e arquibancada" });
  const courtGroup = new THREE.Group();
  courtGroup.position.set(court.x, 0, court.z);
  const line = new THREE.MeshBasicMaterial({ color: 0xece5d9 });
  box(courtGroup, [court.width - .7, .025, .09], [0, .115, -court.depth / 2 + .38], line, false);
  box(courtGroup, [court.width - .7, .025, .09], [0, .115, court.depth / 2 - .38], line, false);
  box(courtGroup, [.09, .025, court.depth - .7], [-court.width / 2 + .38, .115, 0], line, false);
  box(courtGroup, [.09, .025, court.depth - .7], [court.width / 2 - .38, .115, 0], line, false);
  box(courtGroup, [court.width - .7, .025, .07], [0, .118, 0], line, false);
  const centerCircle = new THREE.Mesh(new THREE.TorusGeometry(1.55, .055, 8, 42), line);
  centerCircle.rotation.x = Math.PI / 2;
  centerCircle.position.y = .13;
  courtGroup.add(centerCircle);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.34, 16, 12), standard(0xc96836, .72));
  ball.position.set(2.2, .38, -.9);
  ball.castShadow = true;
  courtGroup.add(ball);
  addBasketHoop(courtGroup, -court.depth / 2 + .8, 0, obstacles, court.x, court.z);
  addBasketHoop(courtGroup, court.depth / 2 - .8, Math.PI, obstacles, court.x, court.z);
  park.add(courtGroup);
  const bleacherX = court.x - court.width / 2 - 1.05;
  addBenchFacing(park, "quadra-arquibancada-1", bleacherX, court.z - 4.4, "arquibancada da quadra", seats, court.x, court.z);
  addBenchFacing(park, "quadra-arquibancada-2", bleacherX, court.z + 4.4, "arquibancada da quadra", seats, court.x, court.z);
  const courtSign = new THREE.Group();
  courtSign.position.set(court.x, 0, court.z - court.depth / 2 + .45);
  box(courtSign, [5.7, 1.45, .18], [0, 1.15, 0], standard(0x394f59, .58));
  planeLabel(courtSign, "QUADRA DO BECO", 5.15, .8, [0, 1.18, .11], "#fff6df", "#405b66");
  park.add(courtSign);

  scene.add(park);
  [[-23, 37], [-23, 47], [-8, 48], [8, 48], [24, 47]].forEach(([x, z], index) => addTree(scene, x, z, obstacles, .74 + (index % 2) * .08));
}

function addResidentLot(scene: THREE.Scene, house: NeighborhoodHouse, lot: ReturnType<typeof createResidentialLots>[number], index: number, night: boolean, obstacles: StreetObstacle[]) {
  const group = new THREE.Group();
  group.position.set(lot.x, 0, lot.z);
  group.rotation.y = lot.rotation;
  const [wallColor, trimColor, accentColor] = RESIDENT_PALETTES[index % RESIDENT_PALETTES.length];
  const interaction: Interaction = { kind: "house", house };
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: wallColor,
    emissive: wallColor,
    emissiveIntensity: night ? .16 : 0,
    roughness: .76,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: trimColor,
    emissive: trimColor,
    emissiveIntensity: night ? .1 : 0,
    roughness: .52,
    metalness: .18,
  });

  const lawn = box(group, [6.65, .18, 5.25], [0, .09, 0], standard(index % 2 ? 0x365746 : 0x405d45, .98), false);
  box(group, [6.9, .13, .3], [0, .13, 2.53], standard(0xb5abb3, .9), false);
  box(group, [1.35, .08, 2.05], [0, .2, 1.42], standard(0xc9b99e, .94), false);

  // A low, wide Brazilian home: a real two-sided roof avoids the former
  // stretched pyramid silhouette while keeping doors at human scale.
  const body = box(group, [5.65, 5.05, 3.35], [0, 2.62, -.62], wallMaterial);
  box(group, [5.82, .3, 3.52], [0, .18, -.62], standard(trimColor, .58));
  const frontRoof = box(group, [6.08, .2, 2.35], [0, 5.83, .3], roofMaterial);
  frontRoof.rotation.x = .54;
  const rearRoof = box(group, [6.08, .2, 2.35], [0, 5.83, -1.55], roofMaterial);
  rearRoof.rotation.x = -.54;
  box(group, [6.16, .2, .24], [0, 6.47, -.62], standard(trimColor, .48, .22));
  box(group, [2.2, .16, .92], [0, 3.72, 1.52], standard(trimColor, .56));

  const glow = new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xffbd55, emissiveIntensity: night ? 1.55 : .18, roughness: .34 });
  [-1.62, 1.62].forEach((x) => {
    box(group, [1.15, 1.3, .14], [x, 3.02, 1.08], glow);
    box(group, [.08, 1.34, .18], [x, 3.02, 1.17], standard(trimColor, .45));
    box(group, [1.18, .08, .18], [x, 3.02, 1.17], standard(trimColor, .45));
    box(group, [1.1, 1.05, .12], [x, 3.16, -2.36], glow);
  });
  const door = box(group, [1.12, 3.3, .18], [0, 1.78, 1.12], standard(trimColor, .62));
  const handle = new THREE.Mesh(new THREE.SphereGeometry(.09, 10, 8), standard(accentColor, .28, .72));
  handle.position.set(.36, 1.78, 1.25);
  group.add(handle);
  box(group, [1.95, .16, .82], [0, .62, 1.42], standard(accentColor, .68));

  const mailbox = new THREE.Group();
  mailbox.position.set(-2.35, 0, 1.72);
  box(mailbox, [.1, 1.25, .1], [0, .72, 0], standard(0x39313d, .38, .62));
  box(mailbox, [.7, .48, .48], [0, 1.35, 0], standard(accentColor, .48));
  group.add(mailbox);

  const cleanliness = Math.max(0, Math.min(100, Number(house.cleanliness) || 0));
  const gardenCount = cleanliness >= 70 ? 4 : cleanliness >= 35 ? 2 : 1;
  for (let plant = 0; plant < gardenCount; plant += 1) {
    const shrub = new THREE.Mesh(new THREE.DodecahedronGeometry(.3 + (plant % 2) * .08, 0), standard(0x3f8056, .94));
    shrub.position.set(-2.35 + plant * 1.52, .43, .72 + (plant % 2) * .3);
    shrub.castShadow = true;
    group.add(shrub);
  }
  if (Number(house.securityLevel) > 0) {
    [-3.05, 3.05].forEach((x) => box(group, [.12, 1.2, .12], [x, .7, 2.22], standard(0x4c4652, .35, .65)));
    box(group, [6.2, .08, .08], [0, 1.1, 2.22], standard(0x4c4652, .35, .65));
    box(group, [6.2, .08, .08], [0, .58, 2.22], standard(0x4c4652, .35, .65));
  }

  const safeName = String(house.nickname || "Morador").trim().slice(0, 24) || "Morador";
  spriteLabel(group, `CASA ${String(lot.number).padStart(2, "0")} · ${safeName}`, 4.85, 1.02, [0, 7.35, .15], "#fff7df", cssColor(trimColor));
  spriteLabel(group, `LIMPEZA ${cleanliness}% · SEG ${Math.max(0, Number(house.securityLevel) || 0)}`, 3.05, .72, [0, 6.56, .2], "#f8f2ff", "rgba(31,25,43,.92)");
  [lawn, body, door].forEach((mesh) => attachInteraction(mesh, interaction));
  invisibleHit(group, [6.6, 7.1, 5.1], [0, 3.35, 0], interaction);
  scene.add(group);

  const sideways = lot.zone !== "north";
  obstacles.push({ kind: "box", x: lot.x, z: lot.z, width: sideways ? 5.25 : 6.65, depth: sideways ? 6.65 : 5.25 });
}

function addResidentialDistrict(scene: THREE.Scene, houses: NeighborhoodHouse[], obstacles: StreetObstacle[], night: boolean) {
  const roadMaterial = new THREE.MeshPhysicalMaterial({ color: 0x292b37, roughness: .48, metalness: .08, clearcoat: .45 });
  const pavementMaterial = standard(0xb3adb4, .92);
  RESIDENTIAL_ROADS.forEach((road) => addGroundRect(scene, road.width, road.depth, road.x, road.z, roadMaterial));
  RESIDENTIAL_SIDEWALKS.forEach((sidewalk) => addGroundRect(scene, sidewalk.width, sidewalk.depth, sidewalk.x, sidewalk.z, pavementMaterial, .07));
  addGroundRect(scene, 5.2, 25, 0, 43.5, standard(0xcdbda6, .96), .075);

  const entrance = new THREE.Group();
  entrance.position.set(0, 0, EXPANDED_PLAZA_BOUNDS.maxZ - .35);
  entrance.scale.y = 1.2;
  const arch = standard(0x55425e, .42, .4);
  [-4.5, 4.5].forEach((x) => box(entrance, [.28, 5.4, .28], [x, 2.7, 0], arch));
  box(entrance, [9.3, .3, .3], [0, 5.25, 0], arch);
  planeLabel(entrance, "VILA DOS MORADORES", 8.35, 1.05, [0, 4.62, .18], "#fff3cd", "#5b405e");
  scene.add(entrance);

  const lots = createResidentialLots(houses.length);
  lots.forEach((lot, index) => addResidentLot(scene, houses[index]!, lot, index, night, obstacles));
  createResidentialLampPosts().forEach((lamp) => addLamp(scene, lamp.x, lamp.z, night, lamp.rotation));
}

function addStreet(scene: THREE.Scene, houses: NeighborhoodHouse[], seats: Seat[], obstacles: StreetObstacle[], night: boolean) {
  const mapWidth = WORLD_X * 2 + 4;
  const mapDepth = WORLD_Z * 2 + 12;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(mapWidth, mapDepth), standard(COLORS.grass, 1));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.ground = true;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(mapWidth, 10.8), new THREE.MeshPhysicalMaterial({ color: COLORS.road, roughness: 0.38, metalness: 0.12, clearcoat: 0.7, clearcoatRoughness: 0.28 }));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.035;
  road.receiveShadow = true;
  road.userData.ground = true;
  scene.add(road);
  [-7.1, 7.1].forEach(z => {
    const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(mapWidth, 3.2), standard(COLORS.sidewalk, 0.92));
    sidewalk.rotation.x = -Math.PI / 2;
    sidewalk.position.set(0, 0.07, z);
    sidewalk.receiveShadow = true;
    sidewalk.userData.ground = true;
    scene.add(sidewalk);
  });
  for (let x = -WORLD_X + 2; x <= WORLD_X - 2; x += 4.2) {
    const marking = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 0.16), new THREE.MeshBasicMaterial({ color: 0xe5c45b }));
    marking.rotation.x = -Math.PI / 2;
    marking.position.set(x, 0.075, 0);
    scene.add(marking);
  }
  for (const [x, z, width] of [[-22, -1.8, 4.5], [-8, 2.1, 6.4], [8, -1.6, 5.2], [23, 2, 6.8]] as const) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(width / 2, 40), new THREE.MeshPhysicalMaterial({ color: 0x405571, roughness: 0.09, metalness: 0.25, clearcoat: 1, transparent: true, opacity: 0.58 }));
    puddle.scale.y = 0.17;
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(x, 0.085, z);
    scene.add(puddle);
  }
  addBar(scene, seats, obstacles, night);
  const soundSystem = addSoundSystem(scene, obstacles, night);
  addProperty(scene, -24, "CAFÉ DO BECO", [0x6b4a76, 0x3f2d4c], night, { kind: "place", label: "Café do Beco" }, obstacles, 8);
  addMercadinho(scene, obstacles);
  addExpandedPlaza(scene, seats, obstacles, night);
  const fountain = addPlaza(scene, seats, obstacles, night);
  addResidentialDistrict(scene, houses, obstacles, night);
  MAIN_STREET_LAMP_POSTS.forEach((lamp) => addLamp(scene, lamp.x, lamp.z, night, lamp.rotation));
  [[-44, -9], [44, -9]].forEach(([x, z], index) => addTree(scene, x, z, obstacles, 0.82 + (index % 2) * 0.12));
  return { ...fountain, soundLeds: soundSystem.leds, soundScreen: soundSystem.screen };
}

function createAvatar(scene: THREE.Scene, avatar: HousePlayer["avatar"] | undefined, nickname: string, position: THREE.Vector3): AvatarBillboard {
  const group = new THREE.Group();
  group.position.copy(position);
  const rig = createAvatar3D(avatar, nickname);
  group.add(rig.root);
  scene.add(group);
  return { group, rig, target: position.clone(), nickname, isMoving: false, reportedMoving: false, seatedAmount: 0, wantsSeated: false };
}

function replaceAvatarTextures(rig: AvatarBillboard, avatar: HousePlayer["avatar"] | undefined) {
  if (getAvatarVisualKey(avatar) === rig.rig.visualKey) return false;
  const previous = rig.rig;
  const replacement = updateAvatar3D(previous, avatar, rig.nickname);
  if (replacement === previous) return false;
  rig.group.add(replacement.root);
  previous.root.removeFromParent();
  disposeAvatar3D(previous);
  rig.rig = replacement;
  return true;
}

function interactionFor(object: THREE.Object3D | null): Interaction | undefined {
  let current = object;
  while (current) {
    if (current.userData.interaction) return current.userData.interaction as Interaction;
    current = current.parent;
  }
  return undefined;
}

function disposeObject(root: THREE.Object3D) {
  disposeStreetObject(root);
}

export default function StreetWorld({ players, houses, localAvatar, speaking = false, onMove, onOpenHouse, onOpenSoundSystem = () => undefined, onSoundSystemScreenRect = () => undefined }: Props) {
  const { acquireRenderer, preset, releaseRenderer } = useCasasGraphics();
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const currentProps = useRef({ players, houses, localAvatar, speaking, onMove, onOpenHouse, onOpenSoundSystem, onSoundSystemScreenRect });
  const [hint, setHint] = useState("Clique no chão para andar. Clique num banco ou cadeira para sentar.");
  const [canToggleSeat, setCanToggleSeat] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("follow");
  const [cameraZoom, setCameraZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  currentProps.current = { players, houses, localAvatar, speaking, onMove, onOpenHouse, onOpenSoundSystem, onSoundSystemScreenRect };

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    mount.replaceChildren();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = acquireRenderer(mount);
    } catch {
      setFailed(true);
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hour = new Date().getHours();
    const night = hour >= 18 || hour < 6;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(night ? COLORS.night : 0x80a8c0);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 240);
    camera.position.set(0, 26, 36);
    camera.lookAt(0, 0, 6);

    renderer.setPixelRatio(preset.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = night ? 1.06 : 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("aria-label", "Bairro e avatares 3D interativos");
    mount.appendChild(renderer.domElement);

    let composer: EffectComposer | null = null;
    let bloom: UnrealBloomPass | null = null;
    if (preset.bloom) {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(preset.pixelRatio * preset.postProcessingScale);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), night ? 0.2 : 0.1, 0.32, 0.92);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    }
    scene.add(new THREE.HemisphereLight(night ? 0x7f91c4 : 0xcde9ff, night ? 0x17251f : 0x4d6d49, night ? 1.45 : 2.5));
    const keyLight = new THREE.DirectionalLight(night ? 0xb9c8ff : 0xfff3d6, night ? 2.15 : 4.2);
    keyLight.position.set(-16, 28, 18);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    keyLight.shadow.camera.left = -52;
    keyLight.shadow.camera.right = 52;
    keyLight.shadow.camera.top = 76;
    keyLight.shadow.camera.bottom = -76;
    keyLight.shadow.bias = -0.0008;
    scene.add(keyLight);

    const seats: Seat[] = [];
    const obstacles: StreetObstacle[] = [];
    const fountain = addStreet(scene, currentProps.current.houses, seats, obstacles, night);
    const dynamicObjects = new Set<THREE.Object3D>([
      fountain.water,
      ...fountain.jets.map((jet) => jet.mesh),
      ...fountain.life.map((item) => item.mesh),
      ...(fountain.soundLeds || []),
      ...(fountain.soundScreen ? [fountain.soundScreen] : []),
    ]);
    const microShadowRadius = preset.id === "performance" ? .24 : preset.id === "balanced" ? .14 : 0;
    disableMicroShadowCasters(scene, microShadowRadius);
    const initialStaticBatch = instanceRepeatedStaticMeshes(scene, dynamicObjects);
    const initialStaticMerge = mergeStaticMeshesByMaterial(scene, dynamicObjects);
    let savedDrawCalls = initialStaticBatch.savedDrawCalls + initialStaticMerge.savedDrawCalls;
    const staticBatches = initialStaticBatch.batches;
    const local = createAvatar(scene, currentProps.current.localAvatar, "VOCÊ", new THREE.Vector3(0, AVATAR_GROUND_Y, 3));
    const remotes = new Map<string, AvatarBillboard>();
    const avatarBatch = createAvatarRenderBatch(scene);
    let avatarSavedDrawCalls = 0;
    let avatarBatchInitialized = false;
    const keys = new Set<string>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const cameraTarget = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const cameraBase = new THREE.Vector3();
    const keyboard = new THREE.Vector3();
    const movementBefore = new THREE.Vector3();
    const movementDesired = new THREE.Vector3();
    const projectedScreenCorners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const timer = new THREE.Timer();
    timer.connect(document);
    let lastSent = 0;
    let lastMoving = false;
    let disposed = false;
    let pointerDown = { x: 0, y: 0 };
    let activeCameraView: CameraView = "follow";
    let activeCameraZoom = 1;
    let lastScreenRect: SoundSystemScreenRect | null = null;
    let lastScreenRectAt = 0;
    let lastStaticCullAt = 0;
    let lastSeatUiAt = 0;
    void Promise.all(STREET_ASSET_URLS.map(loadStreetAsset)).then(() => {
      if (disposed) return;
      disableMicroShadowCasters(scene, microShadowRadius);
      const loadedAssetBatch = instanceRepeatedStaticMeshes(scene, dynamicObjects);
      const loadedAssetMerge = mergeStaticMeshesByMaterial(scene, dynamicObjects);
      savedDrawCalls += loadedAssetBatch.savedDrawCalls + loadedAssetMerge.savedDrawCalls;
      staticBatches.push(...loadedAssetBatch.batches);
      if (new URLSearchParams(window.location.search).get("metrics") === "1") {
        const statistics = { meshes: 0, visibleMeshes: 0, instancedMeshes: 0, instances: 0, shadowCasters: 0, sprites: 0 };
        scene.traverse((object) => {
          if (object instanceof THREE.Sprite) statistics.sprites += 1;
          if (!(object instanceof THREE.Mesh)) return;
          statistics.meshes += 1;
          if (object.visible) statistics.visibleMeshes += 1;
          if (object.castShadow && object.visible) statistics.shadowCasters += 1;
          if (object instanceof THREE.InstancedMesh) {
            statistics.instancedMeshes += 1;
            statistics.instances += object.count;
          }
        });
        renderer.domElement.dataset.casasScene = JSON.stringify(statistics);
      }
    }).catch(() => undefined);

    const syncPlayers = () => {
      const incoming = currentProps.current.players;
      const ids = new Set(incoming.map(player => player.id));
      let batchDirty = false;
      for (const [id, rig] of remotes) {
        if (!ids.has(id)) {
          scene.remove(rig.group);
          disposeObject(rig.group);
          remotes.delete(id);
          batchDirty = true;
        }
      }
      incoming.forEach(player => {
        const destination = worldPoint(player.x, player.y);
        let rig = remotes.get(player.id);
        if (!rig) {
          rig = createAvatar(scene, player.avatar, player.nickname, destination);
          remotes.set(player.id, rig);
          batchDirty = true;
        }
        rig.target.copy(destination);
        rig.reportedMoving = Boolean(player.moving);
        batchDirty = replaceAvatarTextures(rig, player.avatar) || batchDirty;
      });
      batchDirty = replaceAvatarTextures(local, currentProps.current.localAvatar) || batchDirty;
      if (batchDirty || !avatarBatchInitialized) {
        avatarSavedDrawCalls = avatarBatch.rebuild([local.rig, ...Array.from(remotes.values(), value => value.rig)]);
        avatarBatchInitialized = true;
      }
    };

    const nearestSeat = () => seats.reduce<{ seat?: Seat; distance: number }>((result, seat) => {
      const distance = local.group.position.distanceTo(seat.position);
      return distance < result.distance ? { seat, distance } : result;
    }, { distance: Number.POSITIVE_INFINITY });

    const updateSeatUi = () => {
      const nearest = nearestSeat();
      const enabled = Boolean(local.activeSeat || (nearest.seat && nearest.distance < 2.35));
      setCanToggleSeat(previous => previous === enabled ? previous : enabled);
    };

    const stand = () => {
      if (!local.activeSeat && !local.wantsSeated) return;
      local.wantsSeated = false;
      local.activeSeat = undefined;
      local.pendingSeat = undefined;
      setHint("Você levantou. Clique no chão para continuar andando.");
      setCanToggleSeat(false);
    };

    const approachSeat = (seat: Seat) => {
      if (local.activeSeat) stand();
      local.pendingSeat = seat;
      local.target.copy(seat.position);
      local.wantsSeated = false;
      setHint(`Indo até ${seat.label}…`);
      setCanToggleSeat(true);
    };

    const toggleSeat = () => {
      if (local.activeSeat || local.wantsSeated) {
        stand();
        return;
      }
      if (local.pendingSeat) {
        approachSeat(local.pendingSeat);
        return;
      }
      const nearest = nearestSeat();
      if (nearest.seat && nearest.distance < 2.35) approachSeat(nearest.seat);
    };
    const setSceneCameraView = (view: CameraView) => {
      activeCameraView = view;
      setCameraView(view);
      setHint(view === "follow" ? "Câmera seguindo seu avatar." : view === "plaza" ? "Praça ampliada — fonte, jardim, feira e quadra." : view === "village" ? "Vila dos Moradores — clique numa placa para visitar." : "Visão panorâmica do bairro.");
    };
    const changeCameraZoom = (amount: number) => {
      activeCameraZoom = THREE.MathUtils.clamp(activeCameraZoom + amount, .68, 1.5);
      setCameraZoom(activeCameraZoom);
    };
    runtime.current = { syncPlayers, toggleSeat, setCameraView: setSceneCameraView, changeZoom: changeCameraZoom };
    syncPlayers();

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer?.setSize(width, height);
      bloom?.resolution.set(width * preset.postProcessingScale, height * preset.postProcessingScale);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const setPointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    };
    const onPointerDown = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
    const onPointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 8) return;
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObjects(scene.children, true);
      const interactive = intersections.map(hit => interactionFor(hit.object)).find(Boolean);
      if (interactive?.kind === "seat") {
        approachSeat(interactive.seat);
        return;
      }
      if (interactive?.kind === "house") {
        currentProps.current.onOpenHouse(interactive.house);
        return;
      }
      if (interactive?.kind === "sound-system") {
        setHint("Abrindo o navegador virtual do Paredão do Beco…");
        currentProps.current.onOpenSoundSystem();
        return;
      }
      if (interactive?.kind === "place") setHint(interactive.label);
      const groundHit = intersections.find(hit => hit.object.userData.ground);
      if (!groundHit) return;
      if (local.activeSeat || local.wantsSeated) stand();
      local.pendingSeat = undefined;
      local.target.set(
        THREE.MathUtils.clamp(groundHit.point.x, -WORLD_X + 1, WORLD_X - 1),
        AVATAR_GROUND_Y,
        THREE.MathUtils.clamp(groundHit.point.z, -WORLD_Z + 1, WORLD_Z - 1),
      );
      setHint("Caminhando pelo bairro 3D…");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName)) return;
      keys.add(event.code);
      if (event.code === "KeyE") toggleSeat();
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      changeCameraZoom(event.deltaY < 0 ? .1 : -.1);
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const updateAvatarPose = (rig: AvatarBillboard, delta: number, elapsed: number) => {
      const speakingNow = rig === local && currentProps.current.speaking;
      const targetSeated = rig.wantsSeated ? 1 : 0;
      const needsUpdate = rig.isMoving
        || rig.rig.walking > .001
        || Math.abs(rig.seatedAmount - targetSeated) > .001
        || speakingNow
        || rig.rig.voiceIndicator.visible !== speakingNow;
      if (!needsUpdate) return false;
      rig.seatedAmount = THREE.MathUtils.damp(rig.seatedAmount, rig.wantsSeated ? 1 : 0, reducedMotion ? 18 : 5.8, delta);
      animateAvatar3D(rig.rig, elapsed, rig.isMoving, rig.seatedAmount, reducedMotion, delta, speakingNow);
      return true;
    };

    const animate = () => {
      if (disposed) return;
      timer.update();
      const delta = Math.min(timer.getDelta(), 0.05);
      const elapsed = timer.getElapsed();
      keyboard.set(
        Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")),
        0,
        Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp")),
      );
      if (keyboard.lengthSq() > 0 && !local.wantsSeated) {
        if (local.activeSeat) stand();
        keyboard.normalize().multiplyScalar(PLAYER_SPEED * delta);
        local.target.copy(local.group.position).add(keyboard);
        local.target.x = THREE.MathUtils.clamp(local.target.x, -WORLD_X + 1, WORLD_X - 1);
        local.target.z = THREE.MathUtils.clamp(local.target.z, -WORLD_Z + 1, WORLD_Z - 1);
        local.pendingSeat = undefined;
      }
      const distance = local.group.position.distanceTo(local.target);
      local.isMoving = distance > 0.08 && !local.wantsSeated;
      if (local.isMoving) {
        movementBefore.copy(local.group.position);
        movementDesired.copy(local.group.position).lerp(local.target, Math.min(1, PLAYER_SPEED * delta / Math.max(distance, 0.001)));
        const resolved = resolveStreetPosition(movementDesired, obstacles);
        local.group.position.set(resolved.x, AVATAR_GROUND_Y, resolved.z);
        if (Math.hypot(resolved.x - movementDesired.x, resolved.z - movementDesired.z) > .001) local.target.copy(local.group.position);
        if (local.group.position.distanceToSquared(movementBefore) > .00001) {
          local.group.rotation.y = dampAngle(local.group.rotation.y, yawToPoint(movementBefore, local.group.position), 14, delta);
        }
      } else if (local.activeSeat) {
        local.group.rotation.y = dampAngle(local.group.rotation.y, local.activeSeat.facing, 16, delta);
      }
      if (local.pendingSeat && local.group.position.distanceTo(local.pendingSeat.position) < 0.12) {
        local.group.position.copy(local.pendingSeat.position);
        local.activeSeat = local.pendingSeat;
        local.pendingSeat = undefined;
        local.wantsSeated = true;
        local.isMoving = false;
        setHint(`Sentado em ${local.activeSeat.label}. Pressione E ou use Levantar.`);
        setCanToggleSeat(true);
      }
      let avatarMatricesDirty = local.isMoving || updateAvatarPose(local, delta, elapsed);
      remotes.forEach(rig => {
        movementBefore.copy(rig.group.position);
        rig.isMoving = rig.reportedMoving || movementBefore.distanceTo(rig.target) > 0.05;
        rig.group.position.lerp(rig.target, 1 - Math.exp(-8 * delta));
        const moved = rig.group.position.distanceToSquared(movementBefore) > .00001;
        if (moved) {
          rig.group.rotation.y = dampAngle(rig.group.rotation.y, yawToPoint(movementBefore, rig.group.position), 14, delta);
        }
        avatarMatricesDirty = moved || updateAvatarPose(rig, delta, elapsed) || avatarMatricesDirty;
      });
      if (avatarMatricesDirty) avatarBatch.update();
      if (shouldPublishMovement({ moving: local.isMoving, wasMoving: lastMoving, elapsed, lastSent, interval: 0.14 })) {
        const point = networkPoint(local.group.position);
        currentProps.current.onMove(point.x, point.y, local.isMoving);
        lastSent = elapsed;
        lastMoving = local.isMoving;
      }
      if (elapsed - lastSeatUiAt >= .15) {
        updateSeatUi();
        lastSeatUiAt = elapsed;
      }
      if (activeCameraView === "follow") {
        cameraBase.set(THREE.MathUtils.clamp(local.group.position.x * .5, -30, 30), 26, THREE.MathUtils.clamp(local.group.position.z + 35, 20, 103));
        cameraTarget.set(local.group.position.x * .58, .7, THREE.MathUtils.clamp(local.group.position.z + 5.5, -7, WORLD_Z - 7));
      } else if (activeCameraView === "plaza") {
        cameraBase.set(0, 43, 69);
        cameraTarget.set(0, .55, 29);
      } else if (activeCameraView === "village") {
        cameraBase.set(0, 49, 102);
        cameraTarget.set(0, .7, 51);
      } else {
        cameraBase.set(0, 76, 103);
        cameraTarget.set(0, .45, 31);
      }
      cameraPosition.copy(cameraBase).sub(cameraTarget).multiplyScalar(1 / activeCameraZoom).add(cameraTarget);
      camera.position.lerp(cameraPosition, 1 - Math.exp(-2.8 * delta));
      camera.lookAt(cameraTarget);
      camera.updateMatrixWorld();
      if (elapsed - lastStaticCullAt >= .2) {
        staticBatches.forEach((batch) => {
          const radius = batch.boundingSphere?.radius ?? 0;
          batch.visible = !batch.boundingSphere || camera.position.distanceTo(batch.boundingSphere.center) <= 210 + radius;
        });
        lastStaticCullAt = elapsed;
      }
      if (fountain.soundScreen && elapsed - lastScreenRectAt >= 0.05) {
        fountain.soundScreen.updateWorldMatrix(true, false);
        const canvasRect = renderer.domElement.getBoundingClientRect();
        projectedScreenCorners[0].set(-1.86, 1.05, .06);
        projectedScreenCorners[1].set(1.86, 1.05, .06);
        projectedScreenCorners[2].set(1.86, -1.05, .06);
        projectedScreenCorners[3].set(-1.86, -1.05, .06);
        let left = canvasRect.right;
        let right = canvasRect.left;
        let top = canvasRect.bottom;
        let bottom = canvasRect.top;
        let inDepthRange = false;
        projectedScreenCorners.forEach((point) => {
          fountain.soundScreen!.localToWorld(point).project(camera);
          const x = canvasRect.left + (point.x + 1) * canvasRect.width / 2;
          const y = canvasRect.top + (1 - point.y) * canvasRect.height / 2;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          inDepthRange ||= point.z >= -1 && point.z <= 1;
        });
        left = Math.max(canvasRect.left, left);
        right = Math.min(canvasRect.right, right);
        top = Math.max(canvasRect.top, top);
        bottom = Math.min(canvasRect.bottom, bottom);
        const visible = inDepthRange && right - left >= 24 && bottom - top >= 14;
        const nextRect = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top), visible };
        const changed = !lastScreenRect
          || lastScreenRect.visible !== nextRect.visible
          || Math.abs(lastScreenRect.left - nextRect.left) > .75
          || Math.abs(lastScreenRect.top - nextRect.top) > .75
          || Math.abs(lastScreenRect.width - nextRect.width) > .75
          || Math.abs(lastScreenRect.height - nextRect.height) > .75;
        if (changed) {
          lastScreenRect = nextRect;
          currentProps.current.onSoundSystemScreenRect(nextRect);
        }
        lastScreenRectAt = elapsed;
      }
      fountain.water.rotation.y += delta * 0.09;
      const waterMaterial = fountain.water.material as THREE.MeshPhysicalMaterial;
      waterMaterial.roughness = 0.13 + Math.sin(elapsed * 0.7) * 0.025;
      fountain.jets.forEach(jet => {
        const scale = .76 + Math.sin(elapsed * 3.4 + jet.phase) * .16;
        jet.mesh.scale.y = scale * jet.height;
        jet.mesh.position.y = jet.baseY + jet.mesh.scale.y / 2;
      });
      fountain.life.forEach(item => {
        const cycle = Math.sin(elapsed * item.speed + item.phase);
        item.mesh.position.y = item.baseY + (cycle + 1) * .5 * item.amplitude;
        const scale = (item.scale || 1) * (1 + cycle * .08);
        item.mesh.scale.setScalar(scale);
        const material = item.mesh.material;
        if (material instanceof THREE.MeshStandardMaterial) material.emissiveIntensity = .55 + (cycle + 1) * .4;
        if (material instanceof THREE.MeshBasicMaterial) material.opacity = .22 + (cycle + 1) * .13;
      });
      fountain.soundLeds?.forEach((mesh, index) => {
        const material = mesh.material;
        const pulse = .72 + (Math.sin(elapsed * (3.8 + index * .24) + index * 1.7) + 1) * .45;
        if (material instanceof THREE.MeshStandardMaterial) material.emissiveIntensity = (night ? 2.3 : .8) * pulse;
      });
      monitor.beginFrame();
      if (composer) composer.render(delta);
      else renderer.render(scene, camera);
      monitor.frame();
    };
    const monitor = createThreePerformanceMonitor("street", renderer, savedDrawCalls + avatarSavedDrawCalls);
    const updateVisibility = () => renderer.setAnimationLoop(document.hidden ? null : animate);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();

    return () => {
      disposed = true;
      timer.disconnect();
      runtime.current = null;
      renderer.setAnimationLoop(null);
      document.removeEventListener("visibilitychange", updateVisibility);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      avatarBatch.dispose();
      disposeObject(scene);
      composer?.dispose();
      monitor.dispose();
      releaseRenderer(mount);
      currentProps.current.onSoundSystemScreenRect(null);
    };
  }, [acquireRenderer, preset, releaseRenderer]);

  useEffect(() => { runtime.current?.syncPlayers(); }, [players, localAvatar]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#111529]" data-testid="street-world-3d">
      <div ref={host} className="absolute inset-0" />
      {failed ? <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-white">Seu navegador não conseguiu iniciar o WebGL necessário para o bairro 3D.</div> : null}
      <div className="pointer-events-none absolute left-[max(.75rem,env(safe-area-inset-left))] top-[4.5rem] z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 rounded-2xl border border-white/15 bg-[#181523]/82 p-1.5 shadow-xl backdrop-blur-md">
        {([ ["follow", "Seguir"], ["plaza", "Praça"], ["village", "Vila"], ["wide", "Mapa"] ] as const).map(([view, label]) => (
          <button key={view} type="button" aria-pressed={cameraView === view} className={`pointer-events-auto rounded-xl px-3 py-2 text-xs font-black transition ${cameraView === view ? "bg-violet-500 text-white shadow-[0_6px_18px_rgba(139,92,246,.35)]" : "text-white/70 hover:bg-white/10 hover:text-white"}`} onClick={() => runtime.current?.setCameraView(view)}>{label}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" aria-label="Afastar câmera" className="pointer-events-auto grid h-8 w-8 place-items-center rounded-lg text-lg font-black text-white/80 transition hover:bg-white/10 hover:text-white" onClick={() => runtime.current?.changeZoom(-.1)}>−</button>
        <span className="min-w-10 text-center text-[11px] font-black tabular-nums text-amber-200">{Math.round(cameraZoom * 100)}%</span>
        <button type="button" aria-label="Aproximar câmera" className="pointer-events-auto grid h-8 w-8 place-items-center rounded-lg text-lg font-black text-white/80 transition hover:bg-white/10 hover:text-white" onClick={() => runtime.current?.changeZoom(.1)}>+</button>
      </div>
      <div className="pointer-events-none absolute inset-x-[max(.75rem,env(safe-area-inset-left))] bottom-[max(.75rem,env(safe-area-inset-bottom))] flex items-end justify-between gap-3">
        <div className="max-w-[min(620px,72vw)] rounded-2xl border border-white/15 bg-[#181523]/84 px-4 py-3 text-sm text-white shadow-xl backdrop-blur-md">
          <span className="mr-2 text-amber-300">◆</span>{hint}
          <span className="ml-2 hidden text-white/55 sm:inline">WASD/setas para andar · E para sentar · roda para zoom</span>
        </div>
        {canToggleSeat ? <button type="button" className="pointer-events-auto shrink-0 rounded-xl border border-amber-200/35 bg-amber-300 px-4 py-3 text-sm font-black text-[#24192e] shadow-[0_8px_30px_rgba(246,211,101,.28)] transition-transform hover:-translate-y-0.5 active:translate-y-0" onClick={() => runtime.current?.toggleSeat()}>Sentar / levantar</button> : null}
      </div>
    </div>
  );
}
