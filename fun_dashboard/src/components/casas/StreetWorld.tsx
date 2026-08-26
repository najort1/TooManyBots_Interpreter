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
import { animateAvatar3D, createAvatar3D, disposeAvatar3D, updateAvatar3D, type Avatar3DRig } from "./avatar3d";
import { getAvatarVisualKey } from "./avatarAppearance.js";

type Props = {
  players: HousePlayer[];
  houses: NeighborhoodHouse[];
  localAvatar?: HousePlayer["avatar"];
  speaking?: boolean;
  onMove: (x: number, y: number, moving: boolean) => void;
  onOpenHouse: (house: NeighborhoodHouse) => void;
};

type Seat = { id: string; label: string; position: THREE.Vector3; facing: number };
type StreetObstacle =
  | { kind: "box"; x: number; z: number; width: number; depth: number }
  | { kind: "circle"; x: number; z: number; radius: number };
type FountainJet = { mesh: THREE.Mesh; baseY: number; height: number; phase: number };
type Fountain = { water: THREE.Mesh; jets: FountainJet[] };
type PlazaLife = { mesh: THREE.Mesh; baseY: number; amplitude: number; speed: number; phase: number; scale?: number };
type Plaza = Fountain & { life: PlazaLife[] };
type Interaction =
  | { kind: "seat"; seat: Seat }
  | { kind: "house"; house: NeighborhoodHouse }
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
type CameraView = "follow" | "plaza" | "wide";
type Runtime = {
  syncPlayers: () => void;
  toggleSeat: () => void;
  setCameraView: (view: CameraView) => void;
  changeZoom: (amount: number) => void;
};

const WORLD_X = 38;
const WORLD_Z = 36;
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
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
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

function attachInteraction(object: THREE.Object3D, interaction: Interaction) {
  object.userData.interaction = interaction;
}

function invisibleHit(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], interaction: Interaction) {
  const hit = box(parent, size, position, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), false);
  hit.receiveShadow = false;
  attachInteraction(hit, interaction);
}

function addLamp(scene: THREE.Scene, x: number, z: number, night: boolean) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  box(group, [0.14, 3.8, 0.14], [0, 1.9, 0], standard(0x282536, 0.35, 0.65));
  box(group, [0.75, 0.1, 0.12], [0.3, 3.72, 0], standard(0x282536, 0.35, 0.65));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: COLORS.warm, emissive: COLORS.warm, emissiveIntensity: night ? 6 : 0.7 }));
  bulb.position.set(0.64, 3.58, 0);
  group.add(bulb);
  if (night) {
    const light = new THREE.PointLight(COLORS.warm, 11, 8, 2);
    light.position.copy(bulb.position);
    group.add(light);
  }
  scene.add(group);
}

function addTree(scene: THREE.Scene, x: number, z: number, obstacles: StreetObstacle[], scale = 1) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34 * scale, 0.5 * scale, 3.2 * scale, 8), standard(0x6c4934, 0.95));
  trunk.position.y = 1.6 * scale;
  trunk.castShadow = trunk.receiveShadow = true;
  group.add(trunk);
  const leaves = standard(0x286346, 0.98);
  [[0, 4.1, 0], [-0.9, 3.7, 0.2], [0.85, 3.8, -0.15], [0.05, 4.6, -0.45]].forEach(([lx, ly, lz], index) => {
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry((index ? 1.15 : 1.35) * scale, 1), leaves);
    crown.position.set(lx * scale, ly * scale, lz * scale);
    crown.castShadow = true;
    group.add(crown);
  });
  scene.add(group);
  obstacles.push({ kind: "circle", x, z, radius: .86 * scale });
}

function addBench(parent: THREE.Object3D, id: string, x: number, z: number, label: string, seats: Seat[], rotation = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  const wood = standard(0x8d512f, 0.82);
  const metal = standard(0x2d2937, 0.32, 0.65);
  [-0.24, 0.08, 0.4].forEach((depth, index) => box(group, [3.25, 0.17, 0.22], [0, 0.64 + index * 0.03, depth], wood));
  [-1.35, 1.35].forEach(px => {
    box(group, [0.16, 0.68, 0.18], [px, 0.34, 0.22], metal);
    box(group, [0.16, 1.25, 0.18], [px, 1.18, -0.43], metal);
  });
  [0.92, 1.28, 1.64].forEach(y => box(group, [3.25, 0.18, 0.18], [0, y, -0.42], wood));
  const seat = { id, label, position: new THREE.Vector3(), facing: rotation };
  seats.push(seat);
  invisibleHit(group, [3.2, 1.4, 1.25], [0, 1.05, 0], { kind: "seat", seat });
  parent.add(group);
  parent.updateMatrixWorld(true);
  seat.position.set(0, AVATAR_GROUND_Y, -0.02).applyMatrix4(group.matrixWorld);
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
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  parent.add(group);
  const wood = standard(0x8a5737, 0.78);
  const tabletop = standard(0x63351f, 0.72);
  const woodEdge = standard(0xb7774a, 0.7);
  const metal = standard(0x36323b, 0.34, 0.62);
  const top = box(group, [3.85, .16, 1.18], [0, 1.08, 0], tabletop);
  const picnicSeats: Seat[] = [];
  [-1.72, -1.15, -.58, 0, .58, 1.15, 1.72].forEach(px => box(group, [.42, .045, 1.28], [px, 1.185, 0], woodEdge));
  [-1.25, 1.25].forEach(px => {
    [-1, 1].forEach(side => {
      const leg = new THREE.Group();
      leg.position.set(px, .54, side * .42);
      leg.rotation.z = side * Math.PI / 7;
      box(leg, [.13, 1.08, .13], [0, 0, 0], metal);
      group.add(leg);
    });
  });
  [-1.16, 1.16].forEach(pz => {
    box(group, [4.05, .16, .58], [0, .64, pz], wood);
    [-1.48, 1.48].forEach(px => box(group, [.13, .64, .13], [px, .32, pz], metal));
    const facing = rotation + (pz < 0 ? 0 : Math.PI);
    const seat: Seat = { id: `${id}-${pz < 0 ? "norte" : "sul"}`, label: "banco da mesa de piquenique", position: new THREE.Vector3(), facing };
    seats.push(seat);
    picnicSeats.push(seat);
    invisibleHit(group, [3.95, 1.35, .72], [0, .7, pz], { kind: "seat", seat });
    parent.updateMatrixWorld(true);
    seat.position.set(0, AVATAR_GROUND_Y, pz).applyMatrix4(group.matrixWorld);
  });
  attachInteraction(top, { kind: "seat", seat: picnicSeats[0]! });
}

function addVendorStall(parent: THREE.Group, id: string, x: number, z: number, title: string, accent: number, product: "popcorn" | "hotdog" | "juice", obstacles: StreetObstacle[], life: PlazaLife[], night: boolean) {
  const stall = new THREE.Group();
  stall.position.set(x, 0, z);
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
  const base = new THREE.Mesh(new THREE.CylinderGeometry(11.45, 12.15, .32, 12), standard(0x948d99, .82));
  base.position.y = .16;
  base.receiveShadow = true;
  base.userData.ground = true;
  plaza.add(base);
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
  addBench(plaza, "praca-fonte-norte", 0, -4.45, "banco da fonte", seats);
  addBench(plaza, "praca-fonte-sul", 0, 4.45, "banco da fonte", seats, Math.PI);
  addBench(plaza, "praca-fonte-oeste", -4.6, 0, "banco da fonte", seats, Math.PI / 2);
  addBench(plaza, "praca-fonte-leste", 4.6, 0, "banco da fonte", seats, -Math.PI / 2);
  addBench(plaza, "praca-entrada-oeste", -4.8, -9.1, "banco perto da entrada", seats, Math.PI / 6);
  addBench(plaza, "praca-entrada-leste", 4.8, -9.1, "banco perto da entrada", seats, -Math.PI / 6);
  addBench(plaza, "praca-feirinha-oeste", -9.2, .2, "banco da feirinha", seats, Math.PI / 2);
  addBench(plaza, "praca-feirinha-leste", 9.2, .2, "banco da feirinha", seats, -Math.PI / 2);
  addFestoonLights(plaza, life, night);
  const gateMaterial = standard(0x5b4558, .42, .42);
  [-2.9, 2.9].forEach(x => box(plaza, [.2, 4.8, .2], [x, 2.42, -10.15], gateMaterial));
  box(plaza, [6.05, .22, .2], [0, 4.72, -10.15], gateMaterial);
  planeLabel(plaza, "FEIRINHA DO BECO", 5.7, .82, [0, 4.15, -10.04], "#fff6dc", "#68445e");
  addBalloonBunch(plaza, -10, -3.1, [0xf4c85e, 0xdf5a63, 0x7fa9e6], life);
  addBalloonBunch(plaza, 10, 5.6, [0x9fe0b5, 0xf1a25d, 0xc989dc], life);
  attachInteraction(base, { kind: "place", label: "Praça do Beco — feira, comida de rua e 20 assentos interativos" });
  scene.add(plaza);
  obstacles.push({ kind: "circle", x: plaza.position.x, z: plaza.position.z, radius: 3.35 });
  return { water, jets, life };
}

function addBar(scene: THREE.Scene, seats: Seat[], obstacles: StreetObstacle[], night: boolean) {
  const bar = new THREE.Group();
  bar.position.set(-8.5, 0, -12.1);
  const wall = box(bar, [11.5, 5.7, 4.2], [0, 2.85, 0], standard(COLORS.yellow, 0.82));
  box(bar, [11.6, 1.05, 4.3], [0, 0.54, 0.01], standard(COLORS.red, 0.74));
  box(bar, [3.2, 3.55, 0.2], [3.35, 2.3, 2.14], standard(0x40242b, 0.72));
  for (let x = -1.36; x <= 1.36; x += 0.34) box(bar, [0.08, 3.25, 0.08], [3.35 + x, 2.35, 2.28], standard(COLORS.red, 0.38, 0.48));
  for (let y = 1; y <= 3.75; y += 0.34) box(bar, [3.05, 0.07, 0.07], [3.35, y, 2.29], standard(COLORS.red, 0.38, 0.48));
  box(bar, [3.2, 2.1, 0.18], [-3.3, 2.55, 2.15], new THREE.MeshStandardMaterial({ color: 0xffcf61, emissive: 0xffb44d, emissiveIntensity: night ? 1.25 : 0.2, roughness: 0.7 }));
  planeLabel(bar, "BAR DO PINTO", 7.8, 1.15, [-0.55, 4.55, 2.16], "#fff9dc", "#a42d32");
  planeLabel(bar, "PITU", 2.8, 1.35, [-1.1, 3.08, 2.18], "#8d262b", "#f5d65f");
  planeLabel(bar, "140 A", 1.7, 0.68, [4.3, 4.25, 2.18], "#2a2230", "#f1c84b");
  const roof = new THREE.Group();
  roof.position.set(0, 5.85, 1.1);
  roof.rotation.x = -0.08;
  for (let x = -5.8; x <= 5.8; x += 0.28) box(roof, [0.18, 0.12, 5.4], [x, 0, 0], standard(0x5a5661, 0.38, 0.72));
  bar.add(roof);
  const tableMaterial = standard(0x2c2830, 0.58);
  [[-3.55, 4.35], [0, 4.35], [3.55, 4.35]].forEach(([x, z], tableIndex) => {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.14, 24), tableMaterial);
    top.position.set(x, 1.05, z); top.castShadow = true; bar.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.19, 1.05, 12), tableMaterial);
    leg.position.set(x, 0.52, z); leg.castShadow = true; bar.add(leg);
    addChair(bar, `bar-${tableIndex}-esquerda`, x - 1.35, z, "cadeira à esquerda da mesa", seats, Math.PI / 2);
    addChair(bar, `bar-${tableIndex}-direita`, x + 1.35, z, "cadeira à direita da mesa", seats, -Math.PI / 2);
    if (tableIndex !== 1) addChair(bar, `bar-${tableIndex}-frente`, x, z + 1.08, "cadeira em frente à mesa", seats, Math.PI);
  });
  attachInteraction(wall, { kind: "place", label: "Bar do Pinto — mesas e cadeiras interativas" });
  scene.add(bar);
  obstacles.push({ kind: "box", x: -8.5, z: -12.1, width: 11.5, depth: 4.2 });
}

function addProperty(scene: THREE.Scene, x: number, title: string, palette: [number, number], night: boolean, interaction: Interaction, obstacles: StreetObstacle[], width = 7, z = -12.3) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
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
  addProperty(scene, -24, "CAFÉ DO BECO", [0x6b4a76, 0x3f2d4c], night, { kind: "place", label: "Café do Beco" }, obstacles, 8);
  addProperty(scene, 23.5, "MERCADINHO", [0x477267, 0x28473f], night, { kind: "place", label: "Mercadinho do bairro" }, obstacles, 9);
  const fountain = addPlaza(scene, seats, obstacles, night);
  houses.slice(0, 6).forEach((house, index) => {
    const colors: Array<[number, number]> = [[0x8b6a77, 0x47344e], [0x527b72, 0x2d4f48], [0x8b704e, 0x55412f]];
    addProperty(scene, -26 + index * 10.4, house.nickname, colors[index % colors.length], night, { kind: "house", house }, obstacles, 8.6, 34.1).rotation.y = Math.PI;
  });
  [-34, -22, -8, 8, 22, 34].forEach((x, index) => addLamp(scene, x, index % 2 ? 6.2 : -6.2, night));
  [[-13.5, 10.2], [13.5, 10.2], [-13.5, 29.8], [13.5, 29.8], [0, 34.6]].forEach(([x, z]) => addLamp(scene, x, z, night));
  [[-34, -9], [-27, 14], [-17, 33], [-14.5, 20], [14.5, 20], [17, 33], [27, 14], [34, -9]].forEach(([x, z], index) => addTree(scene, x, z, obstacles, 0.82 + (index % 2) * 0.12));
  return fountain;
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
  if (getAvatarVisualKey(avatar) === rig.rig.visualKey) return;
  const previous = rig.rig;
  const replacement = updateAvatar3D(previous, avatar, rig.nickname);
  if (replacement === previous) return;
  rig.group.add(replacement.root);
  previous.root.removeFromParent();
  disposeAvatar3D(previous);
  rig.rig = replacement;
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
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        (material as THREE.MeshStandardMaterial).map?.dispose();
        material.dispose();
      });
    }
  });
}

export default function StreetWorld({ players, houses, localAvatar, speaking = false, onMove, onOpenHouse }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const currentProps = useRef({ players, houses, localAvatar, speaking, onMove, onOpenHouse });
  const [hint, setHint] = useState("Clique no chão para andar. Clique num banco ou cadeira para sentar.");
  const [canToggleSeat, setCanToggleSeat] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("follow");
  const [cameraZoom, setCameraZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  currentProps.current = { players, houses, localAvatar, speaking, onMove, onOpenHouse };

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    mount.replaceChildren();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hour = new Date().getHours();
    const night = hour >= 18 || hour < 6;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(night ? COLORS.night : 0x80a8c0);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 160);
    camera.position.set(0, 26, 36);
    camera.lookAt(0, 0, 6);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
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

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), night ? 0.2 : 0.1, 0.32, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    scene.add(new THREE.HemisphereLight(night ? 0x7f91c4 : 0xcde9ff, night ? 0x17251f : 0x4d6d49, night ? 1.45 : 2.5));
    const keyLight = new THREE.DirectionalLight(night ? 0xb9c8ff : 0xfff3d6, night ? 2.15 : 4.2);
    keyLight.position.set(-16, 28, 18);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -38;
    keyLight.shadow.camera.right = 38;
    keyLight.shadow.camera.top = 28;
    keyLight.shadow.camera.bottom = -28;
    keyLight.shadow.bias = -0.0008;
    scene.add(keyLight);

    const seats: Seat[] = [];
    const obstacles: StreetObstacle[] = [];
    const fountain = addStreet(scene, currentProps.current.houses, seats, obstacles, night);
    const local = createAvatar(scene, currentProps.current.localAvatar, "VOCÊ", new THREE.Vector3(0, AVATAR_GROUND_Y, 3));
    const remotes = new Map<string, AvatarBillboard>();
    const keys = new Set<string>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const cameraTarget = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const cameraBase = new THREE.Vector3();
    const timer = new THREE.Timer();
    timer.connect(document);
    let lastSent = 0;
    let lastMoving = false;
    let disposed = false;
    let pointerDown = { x: 0, y: 0 };
    let activeCameraView: CameraView = "follow";
    let activeCameraZoom = 1;

    const syncPlayers = () => {
      const incoming = currentProps.current.players;
      const ids = new Set(incoming.map(player => player.id));
      for (const [id, rig] of remotes) {
        if (!ids.has(id)) {
          scene.remove(rig.group);
          disposeObject(rig.group);
          remotes.delete(id);
        }
      }
      incoming.forEach(player => {
        const destination = worldPoint(player.x, player.y);
        let rig = remotes.get(player.id);
        if (!rig) {
          rig = createAvatar(scene, player.avatar, player.nickname, destination);
          remotes.set(player.id, rig);
        }
        rig.target.copy(destination);
        rig.reportedMoving = Boolean(player.moving);
        replaceAvatarTextures(rig, player.avatar);
      });
      replaceAvatarTextures(local, currentProps.current.localAvatar);
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
      setHint(view === "follow" ? "Câmera seguindo seu avatar." : view === "plaza" ? "Câmera focada na praça e na feirinha." : "Visão panorâmica do bairro.");
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
      composer.setSize(width, height);
      bloom.resolution.set(width, height);
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
      rig.seatedAmount = THREE.MathUtils.damp(rig.seatedAmount, rig.wantsSeated ? 1 : 0, reducedMotion ? 18 : 5.8, delta);
      animateAvatar3D(rig.rig, elapsed, rig.isMoving, rig.seatedAmount, reducedMotion, delta, rig === local && currentProps.current.speaking);
    };

    const animate = () => {
      if (disposed) return;
      timer.update();
      const delta = Math.min(timer.getDelta(), 0.05);
      const elapsed = timer.getElapsed();
      const keyboard = new THREE.Vector3(
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
        const before = local.group.position.clone();
        const desired = local.group.position.clone().lerp(local.target, Math.min(1, PLAYER_SPEED * delta / Math.max(distance, 0.001)));
        const resolved = resolveStreetPosition(desired, obstacles);
        local.group.position.set(resolved.x, AVATAR_GROUND_Y, resolved.z);
        if (Math.hypot(resolved.x - desired.x, resolved.z - desired.z) > .001) local.target.copy(local.group.position);
        if (local.group.position.distanceToSquared(before) > .00001) {
          local.group.rotation.y = dampAngle(local.group.rotation.y, yawToPoint(before, local.group.position), 14, delta);
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
      updateAvatarPose(local, delta, elapsed);
      remotes.forEach(rig => {
        const before = rig.group.position.clone();
        rig.isMoving = rig.reportedMoving || before.distanceTo(rig.target) > 0.05;
        rig.group.position.lerp(rig.target, 1 - Math.exp(-8 * delta));
        if (rig.group.position.distanceToSquared(before) > .00001) {
          rig.group.rotation.y = dampAngle(rig.group.rotation.y, yawToPoint(before, rig.group.position), 14, delta);
        }
        updateAvatarPose(rig, delta, elapsed);
      });
      if (shouldPublishMovement({ moving: local.isMoving, wasMoving: lastMoving, elapsed, lastSent, interval: 0.14 })) {
        const point = networkPoint(local.group.position);
        currentProps.current.onMove(point.x, point.y, local.isMoving);
        lastSent = elapsed;
        lastMoving = local.isMoving;
      }
      updateSeatUi();
      if (activeCameraView === "follow") {
        cameraBase.set(THREE.MathUtils.clamp(local.group.position.x * .5, -21, 21), 26, THREE.MathUtils.clamp(local.group.position.z + 35, 20, 66));
        cameraTarget.set(local.group.position.x * .58, .7, THREE.MathUtils.clamp(local.group.position.z + 5.5, -7, WORLD_Z - 7));
      } else if (activeCameraView === "plaza") {
        cameraBase.set(0, 31, 48);
        cameraTarget.set(0, .55, 20);
      } else {
        cameraBase.set(0, 47, 55);
        cameraTarget.set(0, .45, 13);
      }
      cameraPosition.copy(cameraBase).sub(cameraTarget).multiplyScalar(1 / activeCameraZoom).add(cameraTarget);
      camera.position.lerp(cameraPosition, 1 - Math.exp(-2.8 * delta));
      camera.lookAt(cameraTarget);
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
      composer.render(delta);
    };
    renderer.setAnimationLoop(animate);

    return () => {
      disposed = true;
      timer.disconnect();
      runtime.current = null;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      disposeObject(scene);
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => { runtime.current?.syncPlayers(); }, [players, localAvatar]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#111529]" data-testid="street-world-3d">
      <div ref={host} className="absolute inset-0" />
      {failed ? <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-white">Seu navegador não conseguiu iniciar o WebGL necessário para o bairro 3D.</div> : null}
      <div className="pointer-events-none absolute left-[max(.75rem,env(safe-area-inset-left))] top-[4.5rem] z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5 rounded-2xl border border-white/15 bg-[#181523]/82 p-1.5 shadow-xl backdrop-blur-md">
        {([ ["follow", "Seguir"], ["plaza", "Praça"], ["wide", "Panorâmica"] ] as const).map(([view, label]) => (
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
