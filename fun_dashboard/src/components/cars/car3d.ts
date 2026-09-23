import * as THREE from "three";
import type { CarState } from "@/lib/types";
import {
  PAINT_COLORS,
  SECONDARY_COLORS,
  PAINT_FINISHES,
  HEADLIGHT_TINTS,
  INTERIORS,
  WHEEL_CAMBERS,
  BRAKE_CALIPER_COLORS,
  WHEEL_COLORS,
  NEON_UNDERGLOW,
  SUSPENSIONS,
  WINDOW_TINTS,
} from "../../../../shared/car/domain.js";

export type Car3DRig = {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  interiorGroup: THREE.Group;
  wheelsGroup: THREE.Group;
  leftDoorGroup: THREE.Group;
  rightDoorGroup: THREE.Group;
  paintMaterial: THREE.MeshPhysicalMaterial;
  secondaryMaterial: THREE.MeshPhysicalMaterial;
  glassMaterial: THREE.MeshPhysicalMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  taillightMaterial: THREE.MeshStandardMaterial;
  interiorMaterial: THREE.MeshStandardMaterial;
  brakeCaliperMaterial: THREE.MeshStandardMaterial;
  wheelRimMaterial: THREE.MeshStandardMaterial;
  neonLight: THREE.PointLight;
  neonMesh: THREE.Mesh;
  headlightBeams: THREE.Mesh[];
  exhaustFlames: THREE.Group[];
  spoilers: Record<string, THREE.Object3D>;
  decals: Record<string, THREE.Object3D>;
  bodykits: Record<string, THREE.Object3D>;
  rollCages: Record<string, THREE.Object3D>;
  wheelAssemblies: THREE.Group[];
  wheelRims: THREE.Group[];
  update: (state: CarState) => void;
  setDoorsOpen: (open: boolean) => void;
  setHeadlightsOn: (on: boolean) => void;
  triggerBackfire: () => void;
  dispose: () => void;
};

function resolveHex(idOrHex: string, list: readonly { id: string; hex?: string | null }[], fallback: string): string {
  if (!idOrHex) return fallback;
  const match = list.find(
    (item) => item.id === idOrHex || (item.hex && item.hex.toLowerCase() === idOrHex.toLowerCase())
  );
  if (match?.hex) return match.hex;
  if (/^#[0-9a-fA-F]{6}$/.test(idOrHex)) return idOrHex;
  return fallback;
}

/**
 * Constrói o modelo 3D modular completo de um supercarro esportivo AAA em Three.js.
 */
export function createCar3D(initialState: CarState): Car3DRig {
  const root = new THREE.Group();
  root.name = "CarRootAAA";

  const bodyColor = resolveHex(initialState.color, PAINT_COLORS, "#e63946");
  const secColor = resolveHex(initialState.secondaryColor, SECONDARY_COLORS, "#1d3557");

  // ================= MATERIAIS PBR AUTOMOTIVOS =================
  const paintMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(bodyColor),
    metalness: 0.85,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    reflectivity: 0.9,
  });

  const secondaryMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(secColor),
    metalness: 0.8,
    roughness: 0.22,
    clearcoat: 0.8,
  });

  const carbonMaterial = new THREE.MeshStandardMaterial({
    color: 0x141416,
    roughness: 0.38,
    metalness: 0.3,
  });

  const chromeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.98,
    roughness: 0.06,
  });

  const wheelRimMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.95,
    roughness: 0.12,
  });

  const tireMaterial = new THREE.MeshStandardMaterial({
    color: 0x121214,
    roughness: 0.85,
    metalness: 0.05,
  });

  const brakeRotorMaterial = new THREE.MeshStandardMaterial({
    color: 0x888890,
    metalness: 0.92,
    roughness: 0.18,
  });

  const brakeCaliperMaterial = new THREE.MeshStandardMaterial({
    color: 0xe63946,
    metalness: 0.75,
    roughness: 0.22,
  });

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x090f16,
    transparent: true,
    opacity: 0.45,
    roughness: 0.05,
    metalness: 0.15,
    transmission: 0.65,
    ior: 1.5,
  });

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xe8f4ff),
    emissiveIntensity: 2.5,
    roughness: 0.1,
  });

  const taillightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff1133,
    emissive: new THREE.Color(0xff0022),
    emissiveIntensity: 2.8,
    roughness: 0.1,
  });

  const interiorMaterial = new THREE.MeshStandardMaterial({
    color: 0x16161a,
    roughness: 0.75,
    metalness: 0.1,
  });

  const rollCageMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(secColor),
    metalness: 0.85,
    roughness: 0.2,
  });

  // Grupo da Carroceria (afetado pela suspensão em Y)
  const bodyGroup = new THREE.Group();
  bodyGroup.name = "BodyGroup";
  root.add(bodyGroup);

  // ================= 1. CHASSI & CARROCERIA PRINCIPAL =================
  const chassisGeom = new THREE.BoxGeometry(1.86, 0.22, 4.3);
  const chassisMesh = new THREE.Mesh(chassisGeom, carbonMaterial);
  chassisMesh.position.set(0, 0.38, 0);
  chassisMesh.castShadow = true;
  chassisMesh.receiveShadow = true;
  bodyGroup.add(chassisMesh);

  const lowerBodyGeom = new THREE.BoxGeometry(1.92, 0.44, 4.15);
  const lowerBodyMesh = new THREE.Mesh(lowerBodyGeom, paintMaterial);
  lowerBodyMesh.position.set(0, 0.62, 0);
  lowerBodyMesh.castShadow = true;
  lowerBodyMesh.receiveShadow = true;
  bodyGroup.add(lowerBodyMesh);

  const hoodGeom = new THREE.BoxGeometry(1.8, 0.24, 1.45);
  const hoodMesh = new THREE.Mesh(hoodGeom, paintMaterial);
  hoodMesh.position.set(0, 0.76, 1.25);
  hoodMesh.rotation.x = 0.08;
  hoodMesh.castShadow = true;
  bodyGroup.add(hoodMesh);

  const splitterGeom = new THREE.BoxGeometry(1.95, 0.08, 0.45);
  const splitterMesh = new THREE.Mesh(splitterGeom, secondaryMaterial);
  splitterMesh.position.set(0, 0.32, 2.15);
  splitterMesh.castShadow = true;
  bodyGroup.add(splitterMesh);

  const grilleMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9, metalness: 0.1 })
  );
  grilleMesh.position.set(0, 0.52, 2.18);
  bodyGroup.add(grilleMesh);

  const cabinGeom = new THREE.BoxGeometry(1.5, 0.52, 2.1);
  const cabinMesh = new THREE.Mesh(cabinGeom, paintMaterial);
  cabinMesh.position.set(0, 1.05, -0.2);
  cabinMesh.castShadow = true;
  bodyGroup.add(cabinMesh);

  const windshieldGeom = new THREE.PlaneGeometry(1.42, 0.72);
  const frontWindshield = new THREE.Mesh(windshieldGeom, glassMaterial);
  frontWindshield.position.set(0, 1.08, 0.88);
  frontWindshield.rotation.x = -Math.PI * 0.32;
  bodyGroup.add(frontWindshield);

  const rearWindshield = new THREE.Mesh(windshieldGeom, glassMaterial);
  rearWindshield.position.set(0, 1.06, -1.28);
  rearWindshield.rotation.x = Math.PI * 0.35;
  rearWindshield.rotation.y = Math.PI;
  bodyGroup.add(rearWindshield);

  // ================= 2. PORTAS GAIVOTA (SCISSOR / GULLWING DOORS) =================
  const sideWindowGeom = new THREE.PlaneGeometry(1.85, 0.44);

  const leftDoorGroup = new THREE.Group();
  leftDoorGroup.position.set(0.96, 0.75, 0.6); // Dobradiça dianteira alta
  const leftDoorSkin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 1.7), paintMaterial);
  leftDoorSkin.position.set(0, 0.05, -0.75);
  const leftWindow = new THREE.Mesh(sideWindowGeom, glassMaterial);
  leftWindow.position.set(0, 0.32, -0.75);
  leftWindow.rotation.y = Math.PI * 0.5;
  const leftMirror = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.14), paintMaterial);
  leftMirror.position.set(0.04, 0.22, -0.05);
  leftDoorGroup.add(leftDoorSkin, leftWindow, leftMirror);
  bodyGroup.add(leftDoorGroup);

  const rightDoorGroup = new THREE.Group();
  rightDoorGroup.position.set(-0.96, 0.75, 0.6);
  const rightDoorSkin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 1.7), paintMaterial);
  rightDoorSkin.position.set(0, 0.05, -0.75);
  const rightWindow = new THREE.Mesh(sideWindowGeom, glassMaterial);
  rightWindow.position.set(0, 0.32, -0.75);
  rightWindow.rotation.y = -Math.PI * 0.5;
  const rightMirror = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.14), paintMaterial);
  rightMirror.position.set(-0.04, 0.22, -0.05);
  rightDoorGroup.add(rightDoorSkin, rightWindow, rightMirror);
  bodyGroup.add(rightDoorGroup);

  // ================= 3. COCKPIT & INTERIOR DETALHADO =================
  const interiorGroup = new THREE.Group();
  interiorGroup.name = "CockpitInterior";
  bodyGroup.add(interiorGroup);

  function createBucketSeat(xPos: number) {
    const seatGroup = new THREE.Group();
    const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.52), interiorMaterial);
    seatBase.position.set(0, 0.58, 0);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.58, 0.1), interiorMaterial);
    seatBack.position.set(0, 0.88, -0.22);
    seatBack.rotation.x = -0.12;
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.08), interiorMaterial);
    headrest.position.set(0, 1.2, -0.28);
    const harness = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.45, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xdd1122, roughness: 0.6 })
    );
    harness.position.set(0, 0.88, -0.16);

    seatGroup.add(seatBase, seatBack, headrest, harness);
    seatGroup.position.set(xPos, 0, -0.15);
    return seatGroup;
  }

  interiorGroup.add(createBucketSeat(-0.36), createBucketSeat(0.36));

  const dashMesh = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.28, 0.45), carbonMaterial);
  dashMesh.position.set(0, 0.85, 0.55);
  interiorGroup.add(dashMesh);

  const steeringWheelGroup = new THREE.Group();
  const wheelRimMesh = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 20), carbonMaterial);
  steeringWheelGroup.add(wheelRimMesh);
  steeringWheelGroup.position.set(-0.36, 0.92, 0.35);
  steeringWheelGroup.rotation.x = -Math.PI * 0.25;
  interiorGroup.add(steeringWheelGroup);

  // ================= 4. GAIOLA DE PROTEÇÃO =================
  const rollCages: Record<string, THREE.Object3D> = {};

  const clubsportGroup = new THREE.Group();
  const csBar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.65), rollCageMaterial);
  csBar1.position.set(-0.55, 1.0, -0.55);
  const csBar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.65), rollCageMaterial);
  csBar2.position.set(0.55, 1.0, -0.55);
  const csCross = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.15), rollCageMaterial);
  csCross.position.set(0, 1.25, -0.55);
  csCross.rotation.z = Math.PI * 0.5;
  clubsportGroup.add(csBar1, csBar2, csCross);
  clubsportGroup.visible = false;
  interiorGroup.add(clubsportGroup);
  rollCages.clubsport = clubsportGroup;

  const fullRaceGroup = new THREE.Group();
  fullRaceGroup.add(csBar1.clone(), csBar2.clone(), csCross.clone());
  const frBarL = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1), rollCageMaterial);
  frBarL.position.set(-0.55, 1.25, 0.05);
  frBarL.rotation.x = Math.PI * 0.5;
  const frBarR = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1), rollCageMaterial);
  frBarR.position.set(0.55, 1.25, 0.05);
  frBarR.rotation.x = Math.PI * 0.5;
  fullRaceGroup.add(frBarL, frBarR);
  fullRaceGroup.visible = false;
  interiorGroup.add(fullRaceGroup);
  rollCages.full_race = fullRaceGroup;

  // ================= 5. BODYKITS =================
  const bodykits: Record<string, THREE.Object3D> = {};

  const widebodyGroup = new THREE.Group();
  const flarePositions = [
    { x: 0.98, z: 1.32 },
    { x: -0.98, z: 1.32 },
    { x: 1.02, z: -1.32 },
    { x: -1.02, z: -1.32 },
  ];
  for (const pos of flarePositions) {
    const flareGeom = new THREE.CylinderGeometry(0.48, 0.54, 0.22, 16, 1, false, 0, Math.PI);
    flareGeom.rotateX(Math.PI * 0.5);
    const flare = new THREE.Mesh(flareGeom, paintMaterial);
    flare.position.set(pos.x, 0.45, pos.z);
    if (pos.x < 0) flare.rotation.y = Math.PI;
    widebodyGroup.add(flare);
  }
  widebodyGroup.visible = false;
  bodyGroup.add(widebodyGroup);
  bodykits.widebody = widebodyGroup;

  const timeAttackGroup = new THREE.Group();
  const canardL1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.35), carbonMaterial);
  canardL1.position.set(0.96, 0.54, 2.02);
  canardL1.rotation.y = 0.25;
  const canardR1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.35), carbonMaterial);
  canardR1.position.set(-0.96, 0.54, 2.02);
  canardR1.rotation.y = -0.25;
  const underSplitter = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.65), carbonMaterial);
  underSplitter.position.set(0, 0.24, 2.22);
  timeAttackGroup.add(canardL1, canardR1, underSplitter);
  timeAttackGroup.visible = false;
  bodyGroup.add(timeAttackGroup);
  bodykits.time_attack = timeAttackGroup;

  // ================= 6. FARÓIS & VOLUMETRIC CONES =================
  const headlightLeft = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.18), headlightMaterial);
  headlightLeft.position.set(0.68, 0.74, 2.05);
  bodyGroup.add(headlightLeft);

  const headlightRight = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.18), headlightMaterial);
  headlightRight.position.set(-0.68, 0.74, 2.05);
  bodyGroup.add(headlightRight);

  // Cones de luz volumétricos projetados para frente
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beamGeom = new THREE.ConeGeometry(0.95, 5.5, 16, 1, true);
  beamGeom.rotateX(-Math.PI * 0.5);

  const beamLeft = new THREE.Mesh(beamGeom, beamMat);
  beamLeft.position.set(0.68, 0.74, 4.8);
  bodyGroup.add(beamLeft);

  const beamRight = new THREE.Mesh(beamGeom, beamMat);
  beamRight.position.set(-0.68, 0.74, 4.8);
  bodyGroup.add(beamRight);

  const headlightBeams = [beamLeft, beamRight];

  const taillight = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.12), taillightMaterial);
  taillight.position.set(0, 0.78, -2.08);
  bodyGroup.add(taillight);

  // ================= 7. ESCAPAMENTOS & BACKFIRE FLAMES =================
  const exhaustPositions = [-0.6, -0.45, 0.45, 0.6];
  const exhaustFlames: THREE.Group[] = [];

  for (const x of exhaustPositions) {
    const pipeGeom = new THREE.CylinderGeometry(0.065, 0.065, 0.26, 16);
    pipeGeom.rotateX(Math.PI * 0.5);
    const pipe = new THREE.Mesh(pipeGeom, chromeMaterial);
    pipe.position.set(x, 0.38, -2.18);
    bodyGroup.add(pipe);

    const flameGroup = new THREE.Group();
    const flameCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.32, 8),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.9 })
    );
    flameCone.rotateX(-Math.PI * 0.5);
    const innerFlame = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.22, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 })
    );
    innerFlame.rotateX(-Math.PI * 0.5);
    flameGroup.add(flameCone, innerFlame);
    flameGroup.position.set(x, 0.38, -2.36);
    flameGroup.visible = false;
    bodyGroup.add(flameGroup);
    exhaustFlames.push(flameGroup);
  }

  // Placa Traseira
  const plateCanvas = document.createElement("canvas");
  plateCanvas.width = 256;
  plateCanvas.height = 128;
  const plateCtx = plateCanvas.getContext("2d");
  if (plateCtx) {
    plateCtx.fillStyle = "#ffffff";
    plateCtx.fillRect(0, 0, 256, 128);
    plateCtx.fillStyle = "#003399";
    plateCtx.fillRect(0, 0, 256, 28);
    plateCtx.fillStyle = "#111111";
    plateCtx.font = "bold 56px monospace";
    plateCtx.textAlign = "center";
    plateCtx.textBaseline = "middle";
    plateCtx.fillText(initialState.plateText || "TMB-2026", 128, 78);
  }
  const plateTexture = new THREE.CanvasTexture(plateCanvas);
  const plateMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.22),
    new THREE.MeshStandardMaterial({ map: plateTexture, roughness: 0.3 })
  );
  plateMesh.position.set(0, 0.52, -2.13);
  plateMesh.rotation.y = Math.PI;
  bodyGroup.add(plateMesh);

  // ================= 8. SPOILERS =================
  const spoilers: Record<string, THREE.Object3D> = {};

  const ducktailGroup = new THREE.Group();
  const ducktailMesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.28), secondaryMaterial);
  ducktailMesh.position.set(0, 0.9, -1.98);
  ducktailMesh.rotation.x = -0.28;
  ducktailGroup.add(ducktailMesh);
  ducktailGroup.visible = false;
  bodyGroup.add(ducktailGroup);
  spoilers.ducktail = ducktailGroup;

  const gtWingGroup = new THREE.Group();
  const leftStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42), carbonMaterial);
  leftStrut.position.set(0.45, 1.08, -1.85);
  const rightStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42), carbonMaterial);
  rightStrut.position.set(-0.45, 1.08, -1.85);
  const wingMesh = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.05, 0.42), carbonMaterial);
  wingMesh.position.set(0, 1.3, -1.88);
  wingMesh.rotation.x = 0.08;
  const leftEndplate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.46), secondaryMaterial);
  leftEndplate.position.set(0.94, 1.3, -1.88);
  const rightEndplate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.46), secondaryMaterial);
  rightEndplate.position.set(-0.94, 1.3, -1.88);
  gtWingGroup.add(leftStrut, rightStrut, wingMesh, leftEndplate, rightEndplate);
  gtWingGroup.visible = false;
  bodyGroup.add(gtWingGroup);
  spoilers.gt_wing = gtWingGroup;

  const dragWingGroup = new THREE.Group();
  const dragWingMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.52), secondaryMaterial);
  dragWingMesh.position.set(0, 1.48, -1.95);
  dragWingMesh.rotation.x = 0.12;
  const dragStrutL = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.65), chromeMaterial);
  dragStrutL.position.set(0.5, 1.15, -1.92);
  const dragStrutR = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.65), chromeMaterial);
  dragStrutR.position.set(-0.5, 1.15, -1.92);
  dragWingGroup.add(dragWingMesh, dragStrutL, dragStrutR);
  dragWingGroup.visible = false;
  bodyGroup.add(dragWingGroup);
  spoilers.drag_wing = dragWingGroup;

  // ================= 9. DECALS =================
  const decals: Record<string, THREE.Object3D> = {};

  const stripesGroup = new THREE.Group();
  const stripeGeom = new THREE.PlaneGeometry(0.18, 4.0);
  const stripeL = new THREE.Mesh(stripeGeom, secondaryMaterial);
  stripeL.position.set(0.18, 0.86, 0.0);
  stripeL.rotation.x = -Math.PI * 0.5;
  const stripeR = new THREE.Mesh(stripeGeom, secondaryMaterial);
  stripeR.position.set(-0.18, 0.86, 0.0);
  stripeR.rotation.x = -Math.PI * 0.5;
  stripesGroup.add(stripeL, stripeR);
  stripesGroup.visible = false;
  bodyGroup.add(stripesGroup);
  decals.stripes = stripesGroup;

  const carbonHood = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.35), carbonMaterial);
  carbonHood.position.set(0, 0.89, 1.25);
  carbonHood.rotation.x = -Math.PI * 0.48;
  carbonHood.visible = false;
  bodyGroup.add(carbonHood);
  decals.carbon = carbonHood;

  // ================= 10. NEON UNDERGLOW =================
  const neonLight = new THREE.PointLight(0x00d4ff, 0, 4.5);
  neonLight.position.set(0, 0.15, 0);
  root.add(neonLight);

  const neonMeshGeom = new THREE.PlaneGeometry(1.65, 3.4);
  const neonMeshMat = new THREE.MeshBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const neonMesh = new THREE.Mesh(neonMeshGeom, neonMeshMat);
  neonMesh.rotation.x = -Math.PI * 0.5;
  neonMesh.position.set(0, 0.04, 0);
  root.add(neonMesh);

  // ================= 11. RODAS & SUSPENSÃO =================
  const wheelsGroup = new THREE.Group();
  wheelsGroup.name = "WheelsGroup";
  root.add(wheelsGroup);

  const wheelPositions = [
    { name: "FL", x: 0.94, z: 1.32, isLeft: true },
    { name: "FR", x: -0.94, z: 1.32, isLeft: false },
    { name: "RL", x: 0.94, z: -1.32, isLeft: true },
    { name: "RR", x: -0.94, z: -1.32, isLeft: false },
  ];

  const wheelAssemblies: THREE.Group[] = [];
  const wheelRims: THREE.Group[] = [];

  for (const pos of wheelPositions) {
    const wheelAnchor = new THREE.Group();
    wheelAnchor.position.set(pos.x, 0.36, pos.z);

    const tireGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 24);
    tireGeom.rotateZ(Math.PI * 0.5);
    const tire = new THREE.Mesh(tireGeom, tireMaterial);
    tire.castShadow = true;
    wheelAnchor.add(tire);

    const rotorGeom = new THREE.CylinderGeometry(0.24, 0.24, 0.04, 16);
    rotorGeom.rotateZ(Math.PI * 0.5);
    const rotor = new THREE.Mesh(rotorGeom, brakeRotorMaterial);
    wheelAnchor.add(rotor);

    const caliperGeom = new THREE.BoxGeometry(0.08, 0.14, 0.12);
    const caliper = new THREE.Mesh(caliperGeom, brakeCaliperMaterial);
    caliper.position.set(pos.x > 0 ? -0.06 : 0.06, 0.12, 0);
    wheelAnchor.add(caliper);

    const rimGroup = new THREE.Group();
    rimGroup.name = `Rim_${pos.name}`;
    wheelAnchor.add(rimGroup);
    wheelRims.push(rimGroup);

    wheelAssemblies.push(wheelAnchor);
    wheelsGroup.add(wheelAnchor);
  }

  function rebuildWheelRims(wheelType: string) {
    for (const rimGroup of wheelRims) {
      rimGroup.clear();
      buildRimGeometry(rimGroup, wheelType, wheelRimMaterial, secondaryMaterial);
    }
  }

  function setDoorsOpen(open: boolean) {
    if (open) {
      leftDoorGroup.rotation.set(-Math.PI * 0.26, 0, Math.PI * 0.36);
      rightDoorGroup.rotation.set(-Math.PI * 0.26, 0, -Math.PI * 0.36);
    } else {
      leftDoorGroup.rotation.set(0, 0, 0);
      rightDoorGroup.rotation.set(0, 0, 0);
    }
  }

  function setHeadlightsOn(on: boolean) {
    headlightMaterial.emissiveIntensity = on ? 3.0 : 0.5;
    for (const beam of headlightBeams) {
      beam.visible = on;
    }
  }

  // ================= ATUALIZAÇÃO DO ESTADO =================
  function applyState(state: CarState) {
    const pColor = resolveHex(state.color, PAINT_COLORS, "#e63946");
    paintMaterial.color.set(pColor);

    const finishMatch = PAINT_FINISHES.find((f) => f.id === (state.finish || "glossy"));
    paintMaterial.roughness = finishMatch?.roughness ?? 0.15;
    paintMaterial.metalness = finishMatch?.metalness ?? 0.85;
    paintMaterial.clearcoat = finishMatch?.clearcoat ?? 1.0;

    const sColor = resolveHex(state.secondaryColor, SECONDARY_COLORS, "#1d3557");
    secondaryMaterial.color.set(sColor);
    rollCageMaterial.color.set(sColor);

    const calMatch = BRAKE_CALIPER_COLORS.find((c) => c.id === (state.caliperColor || "red"));
    brakeCaliperMaterial.color.set(calMatch?.hex || "#e63946");

    const wColorMatch = WHEEL_COLORS.find((wc) => wc.id === (state.wheelColor || "chrome"));
    wheelRimMaterial.color.set(wColorMatch?.hex || "#ffffff");

    const sus = SUSPENSIONS.find((s) => s.id === (state.suspension || "normal"));
    const offset = (sus?.heightOffset || 0) * 1.5;
    bodyGroup.position.y = offset;

    const camberMatch = WHEEL_CAMBERS.find((c) => c.id === (state.camber || "neutral"));
    const camberAngle = camberMatch?.angle ?? 0;
    wheelPositions.forEach((pos, idx) => {
      const anchor = wheelAssemblies[idx];
      if (anchor) {
        anchor.rotation.z = pos.isLeft ? -camberAngle : camberAngle;
      }
    });

    for (const [key, obj] of Object.entries(bodykits)) {
      obj.visible = key === state.bodykit;
    }

    const headlightMatch = HEADLIGHT_TINTS.find((h) => h.id === (state.headlight || "xenon"));
    const hColor = headlightMatch?.hex || "#ffffff";
    const hEmissive = headlightMatch?.emissiveHex || "#e8f4ff";
    headlightMaterial.color.set(hColor);
    headlightMaterial.emissive.set(hEmissive);
    for (const beam of headlightBeams) {
      (beam.material as THREE.MeshBasicMaterial).color.set(hColor);
    }

    const intMatch = INTERIORS.find((i) => i.id === (state.interior || "black_leather"));
    if (intMatch?.id === "red_alcantara") {
      interiorMaterial.color.set(0xaa1122);
    } else if (intMatch?.id === "white_vip") {
      interiorMaterial.color.set(0xeeeff4);
    } else if (intMatch?.id === "carbon_race") {
      interiorMaterial.color.set(0x18181c);
    } else {
      interiorMaterial.color.set(0x16161a);
    }

    for (const [key, obj] of Object.entries(rollCages)) {
      obj.visible = key === state.rollCage;
    }

    for (const [key, obj] of Object.entries(spoilers)) {
      obj.visible = key === state.spoiler;
    }

    for (const [key, obj] of Object.entries(decals)) {
      obj.visible = key === state.decal;
    }

    const tint = WINDOW_TINTS.find((t) => t.id === (state.windowTint || "light"));
    glassMaterial.opacity = tint?.opacity ?? 0.45;

    const neon = NEON_UNDERGLOW.find((n) => n.id === (state.neon || "none"));
    if (neon?.hex) {
      neonLight.color.set(neon.hex);
      neonLight.intensity = 4.5;
      (neonMesh.material as THREE.MeshBasicMaterial).color.set(neon.hex);
      (neonMesh.material as THREE.MeshBasicMaterial).opacity = 0.65;
    } else {
      neonLight.intensity = 0;
      (neonMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }

    rebuildWheelRims(state.wheels || "sport");
  }

  applyState(initialState);

  function triggerBackfire() {
    for (const flame of exhaustFlames) {
      flame.visible = true;
      flame.scale.set(1.3, 1.8, 1.3);
    }
    setTimeout(() => {
      for (const flame of exhaustFlames) {
        flame.visible = false;
      }
    }, 180);
  }

  function dispose() {
    paintMaterial.dispose();
    secondaryMaterial.dispose();
    carbonMaterial.dispose();
    chromeMaterial.dispose();
    wheelRimMaterial.dispose();
    tireMaterial.dispose();
    glassMaterial.dispose();
    interiorMaterial.dispose();
    rollCageMaterial.dispose();
    brakeCaliperMaterial.dispose();
    plateTexture.dispose();
  }

  return {
    root,
    bodyGroup,
    interiorGroup,
    wheelsGroup,
    leftDoorGroup,
    rightDoorGroup,
    paintMaterial,
    secondaryMaterial,
    glassMaterial,
    headlightMaterial,
    taillightMaterial,
    interiorMaterial,
    brakeCaliperMaterial,
    wheelRimMaterial,
    neonLight,
    neonMesh,
    headlightBeams,
    exhaustFlames,
    spoilers,
    decals,
    bodykits,
    rollCages,
    wheelAssemblies,
    wheelRims,
    update: applyState,
    setDoorsOpen,
    setHeadlightsOn,
    triggerBackfire,
    dispose,
  };
}

function buildRimGeometry(
  parent: THREE.Group,
  type: string,
  rimMat: THREE.Material,
  secMat: THREE.Material
) {
  switch (type) {
    case "classic": {
      for (let i = 0; i < 12; i += 1) {
        const angle = (i * Math.PI) / 6;
        const spokeGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.32);
        const spoke = new THREE.Mesh(spokeGeom, rimMat);
        spoke.rotation.z = angle;
        parent.add(spoke);
      }
      break;
    }
    case "deep_dish": {
      const lipGeom = new THREE.TorusGeometry(0.32, 0.03, 8, 24);
      lipGeom.rotateY(Math.PI * 0.5);
      const lip = new THREE.Mesh(lipGeom, rimMat);
      parent.add(lip);

      for (let i = 0; i < 5; i += 1) {
        const angle = (i * Math.PI * 2) / 5;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), secMat);
        spoke.rotation.x = angle;
        parent.add(spoke);
      }
      break;
    }
    case "offroad": {
      const ringGeom = new THREE.TorusGeometry(0.3, 0.04, 8, 16);
      ringGeom.rotateY(Math.PI * 0.5);
      const ring = new THREE.Mesh(ringGeom, secMat);
      parent.add(ring);
      for (let i = 0; i < 6; i += 1) {
        const angle = (i * Math.PI * 2) / 6;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05), rimMat);
        bolt.position.set(0, Math.sin(angle) * 0.3, Math.cos(angle) * 0.3);
        bolt.rotateZ(Math.PI * 0.5);
        parent.add(bolt);
      }
      break;
    }
    case "turbofan": {
      const discGeom = new THREE.CylinderGeometry(0.31, 0.31, 0.03, 24);
      discGeom.rotateZ(Math.PI * 0.5);
      const disc = new THREE.Mesh(discGeom, secMat);
      parent.add(disc);
      break;
    }
    case "chrome": {
      for (let i = 0; i < 6; i += 1) {
        const angle = (i * Math.PI * 2) / 6;
        const spokeGeom = new THREE.BoxGeometry(0.05, 0.3, 0.05);
        const spoke = new THREE.Mesh(spokeGeom, rimMat);
        spoke.rotation.x = angle;
        parent.add(spoke);
      }
      break;
    }
    case "sport":
    default: {
      for (let i = 0; i < 5; i += 1) {
        const angle = (i * Math.PI * 2) / 5;
        const spokeGeom = new THREE.BoxGeometry(0.04, 0.32, 0.04);
        const spoke = new THREE.Mesh(spokeGeom, rimMat);
        spoke.rotation.x = angle;
        parent.add(spoke);
      }
      break;
    }
  }

  const capGeom = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 12);
  capGeom.rotateZ(Math.PI * 0.5);
  const cap = new THREE.Mesh(capGeom, rimMat);
  parent.add(cap);
}
