"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { HouseItem, HousePlayer, HouseShopItem, HouseView, NeighborhoodHouse } from "@/lib/types";
import { HOUSE_3D_GRID_BOUNDS, house3dGridLines, house3dGridToWorld, house3dNormalizedToWorld, house3dWorldToGrid, house3dWorldToNormalized } from "@/lib/house3dGrid.js";
import { shouldPublishMovement } from "@/lib/realtimeMovementPolicy.js";
import { reconcileFurnitureItems } from "@/lib/houseFurnitureReconciliation.js";
import { createThreePerformanceMonitor } from "@/lib/threePerformanceMonitor";
import { animateAvatar3D, createAvatar3D, disposeAvatar3D, updateAvatar3D, type Avatar3DRig } from "./avatar3d";
import { useCasasGraphics } from "./CasasGraphicsProvider";
import { isSharedAvatarGeometry, isSharedAvatarMaterial } from "./avatar/resources";
import { createAvatarRenderBatch } from "./avatar/instancing";

type Props = {
  mode: "house" | "neighborhood";
  house: HouseView;
  localAvatar?: HousePlayer["avatar"];
  catalog: HouseShopItem[];
  neighborhood: NeighborhoodHouse[];
  owns: boolean;
  selectedItemId?: string;
  onExit: () => void;
  onOpenNeighbor: (neighbor: NeighborhoodHouse) => void;
  onSelectItem: (item: HouseItem) => void;
  onClearSelection: () => void;
  interactionLocked?: boolean;
  remotePlayers?: HousePlayer[];
  speaking?: boolean;
  onAvatarMove?: (x: number, y: number, moving: boolean) => void;
  onMoveItem: (item: HouseItem, x: number, y: number) => boolean | Promise<boolean>;
};

type FurnitureRig = { group: THREE.Group; item: HouseItem; baseY: number };
type PlayerRig = { rig: Avatar3DRig; target: THREE.Vector3; moving: boolean; reportedMoving: boolean };
type Runtime = {
  syncFurniture: () => void;
  syncLocalAvatar: () => void;
  syncRemotes: () => void;
  syncSelection: () => void;
};

const ROOM_W = 14;
const ROOM_D = 11;
const itemNames: Record<string, string> = {
  sofa_inicial: "Sofá de entrada", planta_inicial: "Planta sobrevivente", tapete_rua: "Tapete da rua",
  mesa_cafe: "Mesa de café", vaso_flores: "Vaso florido", luminaria_neon: "Luminária neon",
  puff_estrela: "Puff estrela", poltrona_vintage: "Poltrona vintage", estante_caotica: "Estante caótica",
  tv_tubo: "TV de tubo", cama_nuvem: "Cama nuvem", jukebox_neon: "Jukebox neon",
  geladeira_premium: "Geladeira premium", gato_sindico: "Gato síndico", camera_porta: "Câmera de porta",
};

const floorColors: Record<string, [number, number]> = {
  piso_lilas: [0x7c5ca1, 0x9a7abc], piso_madeira: [0x9a6848, 0xc08b61],
  piso_xadrez: [0xd5c2a9, 0x684b43], piso_galaxia: [0x26376e, 0x415493],
};
const wallColors: Record<string, [number, number]> = {
  parede_beco: [0x3b2757, 0x30204b], parede_menta: [0x4c796c, 0x3c665c],
  parede_tijolo: [0x824e48, 0x6f413f], parede_noite_neon: [0x202858, 0x171d48],
};

function mat(color: number, roughness = 0.7, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], cast = true) {
  const value = new THREE.Mesh(geometry, material);
  value.position.set(...position);
  value.castShadow = cast;
  value.receiveShadow = true;
  parent.add(value);
  return value;
}

function addBox(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: number, roughness = 0.7, metalness = 0.04) {
  return addMesh(parent, new THREE.BoxGeometry(...size), mat(color, roughness, metalness), position);
}

function gridToWorld(x: number, y: number) {
  const point = house3dGridToWorld(x, y);
  return new THREE.Vector3(point.x, 0, point.z);
}

function worldToGrid(point: THREE.Vector3) {
  return house3dWorldToGrid(point.x, point.z);
}

function normalizedToWorld(x: number, y: number) {
  const point = house3dNormalizedToWorld(x, y);
  return new THREE.Vector3(point.x, 0, point.z);
}

function interactive(group: THREE.Group, item: HouseItem) {
  group.traverse(object => { object.userData.houseItem = item; });
}

function createPlant(group: THREE.Group, flowers = false) {
  addMesh(group, new THREE.CylinderGeometry(0.3, 0.4, 0.52, 16), mat(0xb35f43, 0.88), [0, 0.26, 0]);
  const stems = [-0.3, -0.12, 0.12, 0.3];
  stems.forEach((x, index) => {
    const stem = addMesh(group, new THREE.CylinderGeometry(0.025, 0.035, 0.9 + index % 2 * 0.2, 8), mat(0x397a49, 0.9), [x * .45, 0.95, 0]);
    stem.rotation.z = -x * .8;
    const top = addMesh(group, flowers ? new THREE.IcosahedronGeometry(0.16, 1) : new THREE.SphereGeometry(0.27, 12, 8), mat(flowers ? [0xf58ba8, 0xffd76a, 0xb69cf2, 0xf28f62][index] : 0x56a965, 0.86), [x, 1.35 + index % 2 * .12, 0]);
    if (!flowers) top.scale.set(0.65, 1.25, 0.45);
  });
}

function createFurniture(item: HouseItem) {
  const group = new THREE.Group();
  let baseY = 0;
  switch (item.itemId) {
    case "sofa_inicial":
      addBox(group, [2.5, .55, 1.05], [0, .48, .1], 0x568ee0, .78);
      addBox(group, [2.5, 1.05, .28], [0, 1.15, -.42], 0x4777bd, .78);
      addBox(group, [.3, .75, 1.1], [-1.25, .67, .08], 0x426ba9, .78);
      addBox(group, [.3, .75, 1.1], [1.25, .67, .08], 0x426ba9, .78);
      [-.62, .62].forEach(x => addBox(group, [1.08, .18, .78], [x, .83, .12], 0x78b0f2, .72));
      break;
    case "planta_inicial": createPlant(group); break;
    case "vaso_flores": createPlant(group, true); break;
    case "tapete_rua": {
      baseY = .035;
      const rug = addMesh(group, new THREE.BoxGeometry(2.6, .07, 1.5), mat(0x9e3e4b, .96), [0, .035, 0], false);
      const inner = addMesh(group, new THREE.BoxGeometry(2.1, .075, 1.08), mat(0xe7ad66, .94), [0, .075, 0], false);
      rug.receiveShadow = inner.receiveShadow = true;
      break;
    }
    case "mesa_cafe":
      addBox(group, [1.8, .2, 1.15], [0, 1.02, 0], 0xa9774f, .72);
      [-.72, .72].forEach(x => [-.4, .4].forEach(z => addBox(group, [.13, 1, .13], [x, .5, z], 0x65412e, .78)));
      addMesh(group, new THREE.CylinderGeometry(.15, .15, .32, 16), mat(0xf2e7d4, .55), [.35, 1.28, -.12]);
      break;
    case "puff_estrela":
      addMesh(group, new THREE.CylinderGeometry(.82, .95, .55, 5), mat(0xd66faa, .82), [0, .3, 0]);
      break;
    case "poltrona_vintage":
      addBox(group, [1.2, .58, 1.05], [0, .48, .08], 0xa94f6b, .82);
      addBox(group, [1.22, 1.18, .3], [0, 1.2, -.42], 0x873d58, .82);
      [-.67, .67].forEach(x => addBox(group, [.2, .72, 1.05], [x, .66, .05], 0x873d58, .82));
      break;
    case "cama_nuvem":
      addBox(group, [2.35, .42, 2.1], [0, .36, 0], 0xded9e7, .88);
      addBox(group, [2.35, 1.35, .22], [0, .94, -1], 0xa99cc3, .84);
      addBox(group, [.82, .22, .58], [-.55, .7, -.62], 0xffffff, .92);
      addBox(group, [.82, .22, .58], [.42, .7, -.62], 0xf5f0fa, .92);
      addBox(group, [2.15, .13, 1.12], [0, .64, .38], 0x82c4d1, .78);
      break;
    case "luminaria_neon": {
      addMesh(group, new THREE.CylinderGeometry(.35, .48, .12, 20), mat(0x2c3550, .36, .5), [0, .06, 0]);
      addMesh(group, new THREE.CylinderGeometry(.05, .07, 1.35, 10), mat(0x3f4b6e, .32, .58), [0, .75, 0]);
      const bulb = addMesh(group, new THREE.SphereGeometry(.28, 18, 12), new THREE.MeshStandardMaterial({ color: 0x70eefa, emissive: 0x70eefa, emissiveIntensity: 2.2, roughness: .3 }), [0, 1.55, 0]);
      const light = new THREE.PointLight(0x70eefa, 6, 5, 2); light.position.copy(bulb.position); group.add(light);
      break;
    }
    case "jukebox_neon": {
      addBox(group, [1.05, 1.35, .55], [0, .72, 0], 0x5a294f, .55);
      addMesh(group, new THREE.SphereGeometry(.53, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x783867, .55), [0, 1.4, 0]);
      const disc = addMesh(group, new THREE.TorusGeometry(.28, .055, 10, 28), new THREE.MeshStandardMaterial({ color: 0xf0bf61, emissive: 0xec5fab, emissiveIntensity: 1.4 }), [0, 1.38, .46]);
      disc.rotation.x = 0;
      break;
    }
    case "estante_caotica":
      addBox(group, [1.35, 2.25, .42], [0, 1.13, 0], 0x76523d, .82);
      [0.4, 1.05, 1.7].forEach(y => addBox(group, [1.25, .1, .58], [0, y, .05], 0x30213d, .75));
      [0xe85e5d, 0x6ebce7, 0xf0ca67, 0x9be08a, 0xd98cf0].forEach((color, index) => addBox(group, [.16 + index % 2 * .05, .48, .34], [-.48 + index * .24, 1.38, .26], color, .86));
      break;
    case "tv_tubo":
      addBox(group, [1.3, .9, .72], [0, .62, 0], 0x514c5e, .46, .16);
      addBox(group, [.95, .58, .08], [-.08, .67, .39], 0x6ccfc4, .22, .18);
      [-.42, .42].forEach(x => addBox(group, [.12, .3, .14], [x, .15, 0], 0x2d2938, .45));
      break;
    case "geladeira_premium":
      addBox(group, [1.15, 2.35, .95], [0, 1.18, 0], 0xb7e7f3, .32, .32);
      addBox(group, [.08, .68, .08], [.38, 1.55, .51], 0x4d88a4, .25, .65);
      addBox(group, [.08, .55, .08], [.38, .72, .51], 0x4d88a4, .25, .65);
      break;
    case "gato_sindico": {
      addMesh(group, new THREE.SphereGeometry(.42, 18, 12), mat(0xf3aa5f, .88), [0, .45, 0]);
      const head = addMesh(group, new THREE.SphereGeometry(.3, 18, 12), mat(0xf3aa5f, .88), [-.32, .82, .12]);
      [-.48, -.18].forEach(x => { const ear = addMesh(group, new THREE.ConeGeometry(.12, .28, 4), mat(0xf3aa5f, .88), [x, 1.1, .12]); ear.rotation.z = x < -.3 ? -.2 : .2; });
      const tail = addMesh(group, new THREE.TorusGeometry(.46, .07, 8, 20, Math.PI * 1.2), mat(0xe89a4d, .86), [.43, .58, 0]); tail.rotation.y = Math.PI / 2;
      head.rotation.y = -.2;
      break;
    }
    case "camera_porta":
      addBox(group, [.9, .42, .42], [0, 1.35, 0], 0x5b6a87, .35, .42);
      addMesh(group, new THREE.CylinderGeometry(.18, .18, .22, 18), new THREE.MeshStandardMaterial({ color: 0x79dcff, emissive: 0x3b9cff, emissiveIntensity: 1 }), [.22, 1.35, .28]).rotation.x = Math.PI / 2;
      addBox(group, [.12, 1.25, .12], [-.22, .63, 0], 0x354158, .38, .55);
      break;
    default: addBox(group, [1, 1, 1], [0, .5, 0], 0x948aa8, .75);
  }
  const position = gridToWorld(item.x, item.y);
  group.position.set(position.x, baseY, position.z);
  group.rotation.y = -(item.rotation || 0) * Math.PI / 2;
  interactive(group, item);
  return { group, item, baseY } satisfies FurnitureRig;
}

function addRoom(scene: THREE.Scene, house: HouseView) {
  const floorTheme = floorColors[house.house.floorStyle] || floorColors.piso_lilas;
  const wallTheme = wallColors[house.house.wallStyle] || wallColors.parede_beco;
  const floorMaterial = new THREE.MeshPhysicalMaterial({ color: floorTheme[0], roughness: .42, metalness: .08, clearcoat: .55, clearcoatRoughness: .34 });
  const floor = addMesh(scene, new THREE.BoxGeometry(ROOM_W, .24, ROOM_D), floorMaterial, [0, -.12, 0], false);
  floor.userData.floor = true;
  const lines = house3dGridLines();
  const spanX = lines.vertical.at(-1)! - lines.vertical[0];
  const spanZ = lines.horizontal.at(-1)! - lines.horizontal[0];
  lines.vertical.forEach(x => addBox(scene, [.035, .026, spanZ], [x, .02, 0], floorTheme[1], .82).castShadow = false);
  lines.horizontal.forEach(z => addBox(scene, [spanX, .027, .035], [0, .021, z], floorTheme[1], .82).castShadow = false);
  addBox(scene, [ROOM_W, 5.5, .28], [0, 2.75, -ROOM_D / 2], wallTheme[0], .82);
  addBox(scene, [.28, 5.5, ROOM_D], [-ROOM_W / 2, 2.75, 0], wallTheme[1], .82);
  addBox(scene, [ROOM_W, .24, .42], [0, .16, -ROOM_D / 2 + .15], floorTheme[1], .55, .22);
  addBox(scene, [.42, .24, ROOM_D], [-ROOM_W / 2 + .15, .16, 0], floorTheme[1], .55, .22);
  const windowGlow = new THREE.MeshStandardMaterial({ color: 0xc4e9ff, emissive: 0x74b7ff, emissiveIntensity: 1.25, roughness: .22, metalness: .12 });
  addMesh(scene, new THREE.BoxGeometry(3.1, 2.2, .12), windowGlow, [2.3, 3.2, -ROOM_D / 2 + .16]);
  addBox(scene, [.12, 2.25, .18], [2.3, 3.2, -ROOM_D / 2 + .24], 0x2d2942, .38, .48);
  addBox(scene, [3.15, .12, .18], [2.3, 3.2, -ROOM_D / 2 + .24], 0x2d2942, .38, .48);
  const door = addBox(scene, [1.35, 2.75, .2], [-4.65, 1.4, -ROOM_D / 2 + .18], 0x493349, .62);
  door.userData.exitDoor = true;
  addBox(scene, [1.5, .13, .26], [-4.65, 2.8, -ROOM_D / 2 + .24], 0xd9a85e, .38, .25);
  const ceiling = new THREE.RectAreaLight(0xffe6c1, 8, 8, 6);
  ceiling.position.set(0, 5.3, 1.2);
  ceiling.lookAt(0, 0, 0);
  scene.add(ceiling);
  return { floor, door };
}

function dispose(root: THREE.Object3D) {
  root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      if (!isSharedAvatarGeometry(object.geometry)) object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(value => {
        if (isSharedAvatarMaterial(value)) return;
        (value as THREE.MeshStandardMaterial).map?.dispose();
        value.dispose();
      });
    }
  });
}

function findItem(object: THREE.Object3D | null): HouseItem | undefined {
  let current = object;
  while (current) {
    if (current.userData.houseItem) return current.userData.houseItem as HouseItem;
    current = current.parent;
  }
  return undefined;
}

export default function HouseGame3D(props: Props) {
  const { acquireRenderer, preset, releaseRenderer } = useCasasGraphics();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const host = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  const runtime = useRef<Runtime | null>(null);
  const [hint, setHint] = useState("Clique no chão para andar. Clique num móvel para selecionar e arrastar.");
  current.current = props;

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    mount.replaceChildren();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x171020);
    const camera = new THREE.PerspectiveCamera(43, 1, .1, 80);
    camera.position.set(12.4, 11.2, 14.8);
    camera.lookAt(0, 1.1, 0);
    const renderer = acquireRenderer(mount);
    renderer.setPixelRatio(preset.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
    renderer.domElement.setAttribute("aria-label", "Interior 3D da casa");
    mount.appendChild(renderer.domElement);
    let composer: EffectComposer | null = null;
    if (preset.bloom) {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(preset.pixelRatio * preset.postProcessingScale);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), .13, .3, .93));
      composer.addPass(new OutputPass());
    }
    scene.add(new THREE.HemisphereLight(0xb4c7ef, 0x2d2035, 1.8));
    const sun = new THREE.DirectionalLight(0xffe2b8, 3.4);
    sun.position.set(8, 14, 9); sun.castShadow = true; sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -12; sun.shadow.camera.right = sun.shadow.camera.top = 12;
    scene.add(sun);
    const room = addRoom(scene, current.current.house);
    const floor = room.floor;
    const furniture = new Map<string, FurnitureRig>();
    let local = createAvatar3D(current.current.localAvatar || current.current.house.avatar, "VOCÊ");
    local.root.position.copy(normalizedToWorld(50, 80)).setY(.03);
    scene.add(local.root);
    const localTarget = local.root.position.clone();
    const remotes = new Map<string, PlayerRig>();
    const avatarBatch = createAvatarRenderBatch(scene);
    let avatarBatchInitialized = false;
    let avatarSavedDrawCalls = 0;
    const rebuildAvatarBatch = () => {
      avatarSavedDrawCalls = avatarBatch.rebuild([local, ...Array.from(remotes.values(), value => value.rig)]);
      avatarBatchInitialized = true;
    };
    const selection = new THREE.Mesh(new THREE.RingGeometry(.72, .86, 48), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: .88, side: THREE.DoubleSide, depthWrite: false }));
    selection.rotation.x = -Math.PI / 2;
    selection.position.y = .045;
    selection.visible = false;
    scene.add(selection);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const keys = new Set<string>();
    const timer = new THREE.Timer();
    timer.connect(document);
    let drag: { rig: FurnitureRig; from: { x: number; y: number }; moved: boolean } | undefined;
    let lastMove = 0;
    let wasMoving = false;
    let disposed = false;
    const direction = new THREE.Vector3();
    const movementBefore = new THREE.Vector3();
    const movementHeading = new THREE.Vector3();

    const syncSelection = () => {
      const selected = current.current.selectedItemId ? furniture.get(current.current.selectedItemId) : undefined;
      selection.visible = Boolean(selected);
      if (selected) selection.position.set(selected.group.position.x, .05, selected.group.position.z);
    };

    const syncFurniture = () => {
      const previousItems = [...furniture.values()].map((rig) => rig.item);
      const reconciliation = reconcileFurnitureItems(previousItems, current.current.house.items);
      reconciliation.removeIds.forEach((id) => {
        const rig = furniture.get(id);
        if (!rig) return;
        scene.remove(rig.group);
        dispose(rig.group);
        furniture.delete(id);
      });
      reconciliation.createItems.forEach((item) => {
        const rig = createFurniture(item);
        furniture.set(item.id, rig);
        scene.add(rig.group);
      });
      reconciliation.updateItems.forEach((item) => {
        const rig = furniture.get(item.id);
        if (!rig) return;
        const position = gridToWorld(item.x, item.y);
        rig.item = item;
        rig.group.position.set(position.x, rig.baseY, position.z);
        rig.group.rotation.y = -(item.rotation || 0) * Math.PI / 2;
        interactive(rig.group, item);
      });
      syncSelection();
    };

    const syncLocalAvatar = () => {
      const previous = local;
      const replacement = updateAvatar3D(previous, current.current.localAvatar || current.current.house.avatar, "VOCÊ");
      if (replacement === previous) return;
      scene.add(replacement.root);
      previous.root.removeFromParent();
      disposeAvatar3D(previous);
      local = replacement;
      localTarget.copy(local.root.position);
      rebuildAvatarBatch();
    };

    const syncRemotes = () => {
      const incoming = current.current.remotePlayers || [];
      const ids = new Set(incoming.map(player => player.id));
      let batchDirty = false;
      remotes.forEach((remote, id) => {
        if (!ids.has(id)) {
          scene.remove(remote.rig.root);
          disposeAvatar3D(remote.rig);
          remotes.delete(id);
          batchDirty = true;
        }
      });
      incoming.forEach(player => {
        const target = normalizedToWorld(player.x, player.y);
        let remote = remotes.get(player.id);
        if (!remote) {
          const rig = createAvatar3D(player.avatar, player.nickname);
          rig.root.position.copy(target);
          scene.add(rig.root);
          remote = { rig, target, moving: false, reportedMoving: false };
          remotes.set(player.id, remote);
          batchDirty = true;
        } else {
          const previous = remote.rig;
          const replacement = updateAvatar3D(previous, player.avatar, player.nickname);
          if (replacement !== previous) {
            scene.add(replacement.root);
            previous.root.removeFromParent();
            disposeAvatar3D(previous);
            remote.rig = replacement;
            batchDirty = true;
          }
        }
        remote.target.copy(target);
        remote.reportedMoving = Boolean(player.moving);
      });
      if (batchDirty || !avatarBatchInitialized) rebuildAvatarBatch();
    };
    runtime.current = { syncFurniture, syncLocalAvatar, syncRemotes, syncSelection };
    syncFurniture();
    syncLocalAvatar();
    syncRemotes();

    const resize = () => {
      const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); composer?.setSize(width, height);
    };
    const observer = new ResizeObserver(resize); observer.observe(mount); resize();
    const pointerFrom = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const floorPoint = () => raycaster.intersectObject(floor, false)[0]?.point;
    const onDown = (event: PointerEvent) => {
      pointerFrom(event);
      if (raycaster.intersectObject(room.door, false).length) {
        setHint("Saindo pela porta para o bairro…");
        current.current.onExit();
        return;
      }
      const hits = raycaster.intersectObjects([...furniture.values()].map(value => value.group), true);
      const item = hits.map(hit => findItem(hit.object)).find(Boolean);
      if (item) {
        const rig = furniture.get(item.id);
        if (!rig) return;
        current.current.onSelectItem(item);
        selection.visible = true;
        selection.position.set(rig.group.position.x, .05, rig.group.position.z);
        setHint(`${itemNames[item.itemId] || "Móvel"} selecionado${current.current.owns ? " — arraste para reposicionar" : ""}.`);
        if (current.current.owns && !current.current.interactionLocked) drag = { rig, from: { x: item.x, y: item.y }, moved: false };
        return;
      }
      current.current.onClearSelection();
      selection.visible = false;
      const point = floorPoint();
      if (point) localTarget.set(THREE.MathUtils.clamp(point.x, HOUSE_3D_GRID_BOUNDS.minX, HOUSE_3D_GRID_BOUNDS.maxX), .03, THREE.MathUtils.clamp(point.z, HOUSE_3D_GRID_BOUNDS.minZ, HOUSE_3D_GRID_BOUNDS.maxZ));
    };
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      pointerFrom(event);
      const point = floorPoint();
      if (!point) return;
      const cell = worldToGrid(point);
      const world = gridToWorld(cell.x, cell.y);
      drag.rig.group.position.set(world.x, drag.rig.baseY, world.z);
      selection.position.set(world.x, .05, world.z);
      drag.moved = cell.x !== drag.from.x || cell.y !== drag.from.y;
    };
    const onUp = async () => {
      if (!drag) return;
      const currentDrag = drag; drag = undefined;
      if (!currentDrag.moved) return;
      const cell = worldToGrid(currentDrag.rig.group.position);
      const ok = await current.current.onMoveItem(currentDrag.rig.item, cell.x, cell.y);
      if (ok === false) {
        const old = gridToWorld(currentDrag.from.x, currentDrag.from.y);
        currentDrag.rig.group.position.set(old.x, currentDrag.rig.baseY, old.z);
      } else setHint(`${itemNames[currentDrag.rig.item.itemId] || "Móvel"} reposicionado em 3D.`);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (!(["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName))) keys.add(event.code); };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const animate = () => {
      if (disposed) return;
      timer.update();
      const delta = Math.min(timer.getDelta(), .05), elapsed = timer.getElapsed();
      direction.set(Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")), 0, Number(keys.has("KeyS") || keys.has("ArrowDown")) - Number(keys.has("KeyW") || keys.has("ArrowUp")));
      if (direction.lengthSq()) {
        direction.normalize().multiplyScalar(4.2 * delta);
        localTarget.copy(local.root.position).add(direction);
        localTarget.x = THREE.MathUtils.clamp(localTarget.x, HOUSE_3D_GRID_BOUNDS.minX, HOUSE_3D_GRID_BOUNDS.maxX); localTarget.z = THREE.MathUtils.clamp(localTarget.z, HOUSE_3D_GRID_BOUNDS.minZ, HOUSE_3D_GRID_BOUNDS.maxZ);
      }
      const distance = local.root.position.distanceTo(localTarget);
      const moving = distance > .045;
      if (moving) {
        movementBefore.copy(local.root.position);
        local.root.position.lerp(localTarget, Math.min(1, 4.2 * delta / Math.max(distance, .001)));
        movementHeading.copy(local.root.position).sub(movementBefore);
        if (movementHeading.lengthSq()) local.root.rotation.y = Math.atan2(movementHeading.x, movementHeading.z);
      }
      const localSpeaking = Boolean(current.current.speaking);
      let avatarMatricesDirty = moving || local.walking > .001 || localSpeaking || local.voiceIndicator.visible !== localSpeaking;
      if (avatarMatricesDirty) animateAvatar3D(local, elapsed, moving, 0, reducedMotion, delta, localSpeaking);
      remotes.forEach(remote => {
        movementBefore.copy(remote.rig.root.position);
        remote.moving = remote.reportedMoving || movementBefore.distanceTo(remote.target) > .04;
        remote.rig.root.position.lerp(remote.target, 1 - Math.exp(-7 * delta));
        movementHeading.copy(remote.rig.root.position).sub(movementBefore);
        const moved = movementHeading.lengthSq() > 0;
        if (moved) remote.rig.root.rotation.y = Math.atan2(movementHeading.x, movementHeading.z);
        const needsPose = remote.moving || remote.rig.walking > .001;
        if (needsPose) animateAvatar3D(remote.rig, elapsed, remote.moving, 0, reducedMotion, delta);
        avatarMatricesDirty = moved || needsPose || avatarMatricesDirty;
      });
      if (avatarMatricesDirty) avatarBatch.update();
      if (shouldPublishMovement({ moving, wasMoving, elapsed, lastSent: lastMove, interval: .15 })) {
        const point = house3dWorldToNormalized(local.root.position.x, local.root.position.z);
        current.current.onAvatarMove?.(point.x, point.y, moving);
        lastMove = elapsed; wasMoving = moving;
      }
      selection.rotation.z += delta * .35;
      monitor.beginFrame();
      if (composer) composer.render(delta);
      else renderer.render(scene, camera);
      monitor.frame();
    };
    const monitor = createThreePerformanceMonitor("house", renderer, avatarSavedDrawCalls);
    const updateVisibility = () => renderer.setAnimationLoop(document.hidden ? null : animate);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    return () => {
      disposed = true; timer.disconnect(); runtime.current = null; renderer.setAnimationLoop(null); observer.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp);
      avatarBatch.dispose(); dispose(scene); composer?.dispose(); monitor.dispose(); releaseRenderer(mount);
    };
  }, [acquireRenderer, preset, releaseRenderer]);

  useEffect(() => { runtime.current?.syncFurniture(); }, [props.house.items]);
  useEffect(() => { runtime.current?.syncLocalAvatar(); }, [props.house.avatar, props.localAvatar]);
  useEffect(() => { runtime.current?.syncRemotes(); }, [props.remotePlayers]);
  useEffect(() => { runtime.current?.syncSelection(); }, [props.selectedItemId]);

  return <div id={`house-3d-${id}`} className="relative h-full min-h-0 w-full overflow-hidden bg-[#171020]" data-testid="house-world-3d">
    <div ref={host} className="absolute inset-0" />
    <button type="button" onClick={props.onExit} className="absolute bottom-[max(4.5rem,env(safe-area-inset-bottom))] left-[max(.75rem,env(safe-area-inset-left))] z-20 rounded-xl border border-white/15 bg-[#181523]/85 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md">← Sair para o bairro</button>
    <div className="pointer-events-none absolute bottom-[max(.75rem,env(safe-area-inset-bottom))] left-1/2 z-20 max-w-[min(34rem,70vw)] -translate-x-1/2 rounded-xl border border-white/15 bg-[#181523]/82 px-4 py-2 text-center text-xs text-white shadow-lg backdrop-blur-md">{hint}<span className="ml-2 hidden text-white/50 md:inline">WASD/setas para andar</span></div>
  </div>;
}
