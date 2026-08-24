import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { HousePlayer } from "@/lib/types";
import { getAvatarOutfitColor, getAvatarVisualKey } from "./avatarAppearance.js";

export type Avatar3DRig = {
  root: THREE.Group;
  model: THREE.Group;
  fallback: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  shadow: THREE.Mesh;
  voiceIndicator: THREE.Group;
  visualKey: string;
  walking: number;
  seated: number;
  blocky?: BlockyAvatarRuntime;
  disposed?: boolean;
};

type BlockyAvatarRuntime = {
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  active?: THREE.AnimationAction;
};

const skin = 0xd99c72;
const ink = 0x211a2d;
const floorContactOffset = 0.335;
const seatedModelDrop = 0.92;
const blockyModelUrls: Record<string, string> = {
  corpo_beco: "/casas/avatar/kenney/character-b.glb",
  corpo_beca: "/casas/avatar/kenney/character-e.glb",
  corpo_neutro: "/casas/avatar/kenney/character-c.glb",
};
const blockyTemplates = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();

function loadBlockyTemplate(bodyId = "corpo_beco") {
  const modelUrl = blockyModelUrls[bodyId] || blockyModelUrls.corpo_beco;
  let template = blockyTemplates.get(modelUrl);
  if (!template) {
    template = new Promise((resolve, reject) => {
      new GLTFLoader().load(
        modelUrl,
        gltf => resolve({ scene: gltf.scene, animations: gltf.animations }),
        undefined,
        reject,
      );
    });
    blockyTemplates.set(modelUrl, template);
  }
  return template;
}

function material(color: number, roughness = 0.72, metalness = 0.03) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry: THREE.BufferGeometry, color: number, roughness = 0.72, metalness = 0.03) {
  const result = new THREE.Mesh(geometry, material(color, roughness, metalness));
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function glow(geometry: THREE.BufferGeometry, color: number, intensity = 1.2) {
  const result = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.28, metalness: 0.2 }));
  result.castShadow = true;
  return result;
}

function limb(parent: THREE.Group, x: number, y: number, color: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const part = mesh(new THREE.CapsuleGeometry(0.145, 0.55, 5, 10), color);
  part.position.y = -0.38;
  pivot.add(part);
  const wrist = mesh(new THREE.CylinderGeometry(.115, .13, .12, 10), color, .7);
  wrist.position.set(0, -.78, .01);
  pivot.add(wrist);
  const hand = mesh(new THREE.DodecahedronGeometry(.16, 1), color, .72);
  hand.scale.set(.82, 1, .76);
  hand.position.set(0, -.89, .035);
  pivot.add(hand);
  const thumb = mesh(new THREE.SphereGeometry(.065, 10, 8), color, .74);
  thumb.scale.set(.8, 1.2, .75);
  thumb.position.set(x < 0 ? -.125 : .125, -.89, .07);
  pivot.add(thumb);
  parent.add(pivot);
  return pivot;
}

function addSleeve(arm: THREE.Group, outfitColor: number) {
  const sleeve = mesh(new THREE.CapsuleGeometry(.17, .2, 5, 10), outfitColor, .62);
  sleeve.position.y = -.19;
  arm.add(sleeve);
  const cuff = mesh(new THREE.CylinderGeometry(.155, .17, .08, 12), 0x2f2d45, .45, .18);
  cuff.position.y = -.43;
  arm.add(cuff);
}

function leg(parent: THREE.Group, x: number, outfitColor: number) {
  const hip = new THREE.Group();
  hip.position.set(x, 1.2, 0);
  const upper = mesh(new THREE.CapsuleGeometry(0.18, 0.48, 5, 10), outfitColor);
  upper.position.y = -0.35;
  hip.add(upper);
  const knee = new THREE.Group();
  knee.position.y = -0.72;
  const lower = mesh(new THREE.CapsuleGeometry(0.16, 0.48, 5, 10), 0x38405f);
  lower.position.y = -0.35;
  knee.add(lower);
  const shoe = mesh(new THREE.SphereGeometry(0.21, 14, 9), 0x1e1b29, 0.42);
  shoe.scale.set(1.04, 0.66, 1.48);
  shoe.position.set(0, -0.7, 0.09);
  knee.add(shoe);
  const sole = mesh(new THREE.BoxGeometry(0.37, 0.055, 0.46), 0x11101a, 0.36, 0.18);
  sole.position.set(0, -0.81, 0.1);
  knee.add(sole);
  hip.add(knee);
  parent.add(hip);
  return { hip, knee };
}

function labelSprite(text: string, local: boolean) {
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(1.85, 0.46, 1);
  sprite.position.y = 3.48;
  return sprite;
}

function addHair(model: THREE.Group, hairId = "base_face", bodyId = "corpo_beco") {
  const hairColor = hairId.includes("rosa") || hairId.includes("marias") ? 0xf46aa4 : hairId.includes("azul") ? 0x5597ef : hairId.includes("lilas") ? 0x8061c7 : hairId.includes("trancas") ? 0x3b2a39 : bodyId === "corpo_beca" && hairId === "base_face" ? 0x7b4f45 : 0x33283d;
  const hair = new THREE.Group();
  hair.position.y = 2.72;
  if (hairId.includes("cacheado")) {
    const scalp = mesh(new THREE.SphereGeometry(.57, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0x3b2936, .86);
    scalp.position.y = .1;
    hair.add(scalp);
    [[0, .38, .24], [-.24, .35, .26], [.24, .35, .26], [-.44, .21, .13], [.44, .21, .13], [-.32, .23, .46], [0, .18, .52], [.32, .23, .46], [-.12, .29, .55], [.12, .29, .55]].forEach(([x, y, z]) => {
      const curl = mesh(new THREE.IcosahedronGeometry(.25, 2), hairColor, .88);
      curl.position.set(x, y, z);
      hair.add(curl);
    });
  } else if (hairId.includes("bone")) {
    const cap = mesh(new THREE.SphereGeometry(0.48, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x6d45d8, 0.65);
    cap.position.y = 0.08;
    hair.add(cap);
    const brim = mesh(new THREE.BoxGeometry(0.48, 0.07, 0.25), 0x6d45d8, 0.65);
    brim.position.set(0, 0.05, 0.42);
    hair.add(brim);
  } else if (hairId.includes("chapeu")) {
    const crown = mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.35, 16), 0xd1a65e, 0.9);
    crown.position.y = 0.26;
    hair.add(crown);
    hair.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 20), 0xd1a65e, 0.9));
  } else {
    const cap = mesh(new THREE.SphereGeometry(.57, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), hairColor, 0.86);
    cap.position.y = .1;
    hair.add(cap);
    if (bodyId === "corpo_beca" && hairId === "base_face") {
      [-.45, .45].forEach(x => {
        const bob = mesh(new THREE.CapsuleGeometry(.16, .5, 5, 10), hairColor, .8);
        bob.position.set(x, -.16, .03);
        hair.add(bob);
      });
      const fringe = mesh(new THREE.BoxGeometry(.48, .16, .12), hairColor, .82);
      fringe.position.set(-.1, .1, .52);
      fringe.rotation.z = -.08;
      hair.add(fringe);
    }
    if (hairId.includes("caos")) {
      [[-.35, .28, -.06, -.18], [-.18, .53, -.08, -.08], [0, .67, -.1, 0], [.18, .53, -.08, .08], [.35, .28, -.06, .18]].forEach(([x, y, z, tilt], index) => {
        const spike = mesh(new THREE.ConeGeometry(.16, .5 - (index % 2) * .05, 5), index % 2 ? 0x4a3048 : hairColor, .82);
        spike.position.set(x, y, z);
        spike.rotation.z = tilt;
        hair.add(spike);
      });
    }
    if (hairId.includes("franja")) {
      [[-.1, .16, 1.65, .14], [.25, .1, .92, -.24]].forEach(([x, y, width, tilt]) => {
        const fringe = mesh(new THREE.SphereGeometry(.24, 16, 10), 0x398bc6, .72);
        fringe.scale.set(width, .72, .14);
        fringe.position.set(x, y, .56);
        fringe.rotation.z = tilt;
        hair.add(fringe);
      });
    }
    if (hairId.includes("rosa")) {
      [-.38, .38].forEach(x => {
        const tail = mesh(new THREE.SphereGeometry(.24, 14, 10), hairColor, .84);
        tail.position.set(x, -.18, -.08);
        hair.add(tail);
      });
    }
    if (hairId.includes("longo")) {
      [-.4, .4].forEach(x => {
        const lock = mesh(new THREE.CapsuleGeometry(.17, .74, 5, 10), hairColor, .78);
        lock.position.set(x, -.34, .02);
        lock.rotation.z = x * -.16;
        hair.add(lock);
      });
      const fringe = mesh(new THREE.BoxGeometry(.56, .16, .1), hairColor, .8);
      fringe.position.set(0, .14, .53);
      hair.add(fringe);
    }
    if (hairId.includes("marias")) {
      [-.58, .58].forEach(x => {
        const ponytail = mesh(new THREE.SphereGeometry(.26, 14, 10), hairColor, .78);
        ponytail.position.set(x, .08, .02);
        hair.add(ponytail);
        const tie = glow(new THREE.TorusGeometry(.1, .025, 6, 12), 0x81f7ee, .35);
        tie.position.set(x * .78, .1, .25);
        hair.add(tie);
      });
    }
    if (hairId.includes("trancas")) {
      [-.42, -.2, .2, .42].forEach((x, index) => {
        const braid = mesh(new THREE.CapsuleGeometry(.07, .62, 5, 8), index % 2 ? 0x7352a1 : hairColor, .8);
        braid.position.set(x, -.28 + Math.abs(x) * .18, .08);
        braid.rotation.z = x * -.1;
        hair.add(braid);
      });
    }
    if (hairId.includes("bandana")) {
      const band = mesh(new THREE.BoxGeometry(1.02, .14, .14), 0xef5d6f, .72);
      band.position.set(0, -.08, .44);
      hair.add(band);
      const knot = mesh(new THREE.ConeGeometry(.13, .34, 4), 0xef5d6f, .72);
      knot.position.set(.54, -.02, .04);
      knot.rotation.z = -.9;
      hair.add(knot);
    }
    if (hairId.includes("mascara")) {
      const silhouette = new THREE.Shape();
      silhouette.moveTo(-.5, .03);
      silhouette.lineTo(-.38, .2);
      silhouette.lineTo(0, .11);
      silhouette.lineTo(.38, .2);
      silhouette.lineTo(.5, .03);
      silhouette.lineTo(.3, -.22);
      silhouette.lineTo(0, -.3);
      silhouette.lineTo(-.3, -.22);
      silhouette.lineTo(-.5, .03);
      const mask = mesh(new THREE.ShapeGeometry(silhouette), 0x5e3d8f, .36, .24);
      mask.position.set(0, -.1, .57);
      hair.add(mask);
      [-.18, .18].forEach(x => {
        const eyeOpening = mesh(new THREE.SphereGeometry(.065, 10, 8), 0x181426, .38);
        eyeOpening.scale.set(1.18, .72, .35);
        eyeOpening.position.set(x, -.08, .61);
        hair.add(eyeOpening);
      });
      const jewel = glow(new THREE.DodecahedronGeometry(.06, 0), 0xf6d365, .45);
      jewel.position.set(0, -.16, .61);
      hair.add(jewel);
    }
  }
  model.add(hair);
}

function addFace(model: THREE.Group, hairId = "", bodyId = "corpo_beco") {
  [-0.17, 0.17].forEach(x => {
    const eye = mesh(new THREE.SphereGeometry(.06, 12, 8), ink, .48);
    eye.scale.set(.8, 1.12, .55);
    eye.position.set(x, 2.64, .5);
    model.add(eye);
  });
  const smile = mesh(new THREE.TorusGeometry(.09, .017, 6, 12, Math.PI), 0x8e4954, .58);
  smile.rotation.z = Math.PI;
  smile.position.set(0, 2.46, .5);
  model.add(smile);
  if (bodyId === "corpo_beca") {
    [-.32, .32].forEach(x => {
      const blush = mesh(new THREE.SphereGeometry(.09, 10, 8), 0xf08aa8, .68);
      blush.scale.set(1.3, .55, .25);
      blush.position.set(x, 2.49, .5);
      model.add(blush);
    });
    [-.2, .2].forEach(x => {
      const lash = mesh(new THREE.BoxGeometry(.08, .018, .02), ink, .4);
      lash.position.set(x + Math.sign(x) * .05, 2.7, .56);
      lash.rotation.z = x < 0 ? -.35 : .35;
      model.add(lash);
    });
  }
  if (hairId.includes("oculos")) {
    const frame = 0x26203d;
    const lensMaterial = new THREE.MeshStandardMaterial({ color: 0x9fe9ff, emissive: 0x3b83b3, emissiveIntensity: .16, transparent: true, opacity: .58, roughness: .24, metalness: .16 });
    [-.2, .2].forEach(x => {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(.29, .19, .025), lensMaterial);
      lens.position.set(x, 2.65, .55);
      model.add(lens);
      [[0, .105, .31, .035], [0, -.105, .31, .035], [-.155, 0, .035, .21], [.155, 0, .035, .21]].forEach(([dx, dy, width, height]) => {
        const edge = mesh(new THREE.BoxGeometry(width, height, .045), frame, .28, .66);
        edge.position.set(x + dx, 2.65 + dy, .57);
        model.add(edge);
      });
    });
    const bridge = mesh(new THREE.BoxGeometry(.12, .045, .05), frame, .28, .66);
    bridge.position.set(0, 2.65, .57);
    model.add(bridge);
    [-1, 1].forEach(side => {
      const arm = mesh(new THREE.BoxGeometry(.25, .035, .035), frame, .3, .62);
      arm.position.set(side * .47, 2.66, .3);
      arm.rotation.y = side * -.32;
      model.add(arm);
    });
  }
}

function addAccessory(model: THREE.Group, accessory = "") {
  if (accessory.includes("laco")) {
    [-.2, .2].forEach(x => {
      const loop = mesh(new THREE.SphereGeometry(.18, 12, 8), 0xf56fa8, .52);
      loop.scale.set(1.3, .72, .3);
      loop.position.set(x, 3.12, .03);
      loop.rotation.z = x < 0 ? -.3 : .3;
      model.add(loop);
    });
    const knot = glow(new THREE.SphereGeometry(.075, 10, 8), 0xffdf77, .45);
    knot.position.set(0, 3.1, .17);
    model.add(knot);
  } else if (accessory.includes("tiara")) {
    const band = mesh(new THREE.TorusGeometry(.46, .028, 6, 20, Math.PI), 0xbca5ff, .38);
    band.rotation.z = Math.PI;
    band.position.set(0, 3.02, 0);
    model.add(band);
    const moon = glow(new THREE.CircleGeometry(.09, 12), 0xffe382, .48);
    moon.position.set(0, 3.33, .24);
    model.add(moon);
  } else if (accessory.includes("coroa")) {
    const band = mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.16, 12), 0xf6d365, 0.28, 0.6);
    band.position.y = 3.12;
    model.add(band);
    [-0.25, 0, 0.25].forEach(x => {
      const point = mesh(new THREE.ConeGeometry(0.11, 0.38, 8), 0xf6d365, 0.28, 0.6);
      point.position.set(x, 3.38 - Math.abs(x) * .2, 0);
      model.add(point);
    });
  } else if (accessory.includes("fones")) {
    const phones = mesh(new THREE.TorusGeometry(0.52, 0.06, 10, 28, Math.PI), 0x5de7ef, 0.3, 0.45);
    phones.rotation.z = Math.PI;
    phones.position.set(0, 2.77, -.04);
    model.add(phones);
    [-0.5, 0.5].forEach(x => {
      const cup = mesh(new THREE.SphereGeometry(.16, 12, 9), 0x5de7ef, 0.3, 0.45);
      cup.scale.set(.72, 1.16, .48);
      cup.position.set(x, 2.65, .02);
      model.add(cup);
    });
  } else if (accessory.includes("mochila")) {
    const packColor = 0x5476a9;
    const pack = mesh(new THREE.SphereGeometry(.34, 16, 12), packColor, .58);
    pack.scale.set(.92, 1.16, .54);
    pack.position.set(.58, 1.5, .28);
    model.add(pack);
    const flap = mesh(new THREE.BoxGeometry(.48, .2, .09), 0x92b8e8, .48, .14);
    flap.position.set(.58, 1.63, .53);
    model.add(flap);
    const pocket = mesh(new THREE.SphereGeometry(.18, 14, 10), 0x3d4f86, .64);
    pocket.scale.set(1, .72, .34);
    pocket.position.set(.58, 1.38, .54);
    model.add(pocket);
    const strap = mesh(new THREE.CapsuleGeometry(.038, .72, 4, 8), 0x27385f, .46);
    strap.position.set(.17, 1.76, .47);
    strap.rotation.z = -.78;
    model.add(strap);
    const buckle = glow(new THREE.BoxGeometry(.09, .09, .04), 0xf6d365, .3);
    buckle.position.set(.38, 1.61, .58);
    model.add(buckle);
  } else if (accessory.includes("bolsa_estelar")) {
    const strap = mesh(new THREE.TorusGeometry(.46, .035, 8, 20, Math.PI), 0x8d6ada, .46);
    strap.rotation.z = Math.PI / 2;
    strap.position.set(.43, 1.7, .05);
    model.add(strap);
    const bag = mesh(new THREE.BoxGeometry(.48, .4, .2), 0x394173, .62);
    bag.position.set(.55, 1.28, .08);
    model.add(bag);
    [[.47, 1.36], [.6, 1.22], [.67, 1.38]].forEach(([x, y]) => {
      const star = glow(new THREE.DodecahedronGeometry(.045, 0), 0xffe07d, .45);
      star.position.set(x, y, .2);
      model.add(star);
    });
  } else if (accessory.includes("bolsa")) {
    const strap = mesh(new THREE.TorusGeometry(.46, .035, 8, 20, Math.PI), 0x6a3f47, .5);
    strap.rotation.z = Math.PI / 2;
    strap.position.set(.43, 1.72, .05);
    model.add(strap);
    const bag = mesh(new THREE.BoxGeometry(.48, .44, .2), 0xf4d6ac, .7);
    bag.position.set(.55, 1.3, .08);
    model.add(bag);
    const cap = mesh(new THREE.SphereGeometry(.28, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xee675f, .72);
    cap.position.set(.55, 1.58, .09);
    model.add(cap);
    [-.08, .09].forEach(x => {
      const dot = mesh(new THREE.SphereGeometry(.045, 8, 6), 0xfff0d2, .6);
      dot.position.set(.55 + x, 1.64, .3);
      model.add(dot);
    });
  } else if (accessory.includes("asas")) {
    [-1, 1].forEach(side => {
      const wing = mesh(new THREE.SphereGeometry(.48, 14, 10), 0xa9d4ff, 0.35, 0.08);
      wing.scale.set(.7, 1.38, .22);
      wing.position.set(side * .67, 1.85, -0.32);
      wing.rotation.z = side * -.34;
      model.add(wing);
      [-.18, 0, .18].forEach((offset, index) => {
        const feather = mesh(new THREE.SphereGeometry(.17, 10, 8), index === 1 ? 0xe4f4ff : 0x7ab4e2, .48);
        feather.scale.set(.58, 1.15, .22);
        feather.position.set(side * (.75 + offset * .6), 1.56 + Math.abs(offset) * .55, -.4);
        feather.rotation.z = side * (.35 + offset);
        model.add(feather);
      });
    });
  } else if (accessory.includes("corrente")) {
    const chainPoints: Array<[number, number]> = [[-.3, 2.13], [-.24, 2.04], [-.16, 1.98], [-.08, 1.94], [0, 1.92], [.08, 1.94], [.16, 1.98], [.24, 2.04], [.3, 2.13]];
    chainPoints.forEach(([x, y], index) => {
      const link = mesh(new THREE.TorusGeometry(.035, .009, 6, 12), 0xf6d365, .24, .72);
      link.position.set(x, y, .48);
      link.rotation.z = index % 2 ? Math.PI / 2 : 0;
      model.add(link);
    });
    const pendant = glow(new THREE.DodecahedronGeometry(.075, 0), 0xffd76a, .38);
    pendant.position.set(0, 1.83, .54);
    model.add(pendant);
  } else if (accessory.includes("cachecol")) {
    const loop = mesh(new THREE.TorusGeometry(.41, .07, 10, 24), 0xf07191, .62);
    loop.rotation.x = Math.PI / 2;
    loop.position.set(0, 2.08, .02);
    model.add(loop);
    const knot = mesh(new THREE.SphereGeometry(.115, 12, 9), 0x7056c8, .62);
    knot.scale.set(1.15, .82, .55);
    knot.position.set(.06, 2.02, .43);
    model.add(knot);
    const frontTail = mesh(new THREE.CapsuleGeometry(.095, .46, 5, 10), 0x7056c8, .66);
    frontTail.position.set(.18, 1.74, .46);
    frontTail.rotation.z = -.16;
    model.add(frontTail);
    const backTail = mesh(new THREE.CapsuleGeometry(.075, .28, 5, 10), 0xf07191, .66);
    backTail.position.set(-.18, 1.84, .4);
    backTail.rotation.z = .3;
    model.add(backTail);
    [[.13, 1.9], [.19, 1.74], [.23, 1.59]].forEach(([x, y]) => {
      const star = glow(new THREE.DodecahedronGeometry(.043, 0), 0xffdf78, .42);
      star.position.set(x, y, .57);
      model.add(star);
    });
  } else if (accessory.includes("aura")) {
    [0, .42].forEach((y, index) => {
      const aura = glow(new THREE.TorusGeometry(.9 - index * .12, .025, 8, 32), index ? 0xf79cff : 0x8cf4ff, .9);
      aura.rotation.x = Math.PI / 2;
      aura.position.set(0, 1.7 + y, -0.06);
      model.add(aura);
    });
  } else if (accessory.includes("brincos")) {
    [-.57, .57].forEach(x => {
      const hook = mesh(new THREE.TorusGeometry(.06, .012, 6, 12), 0xf6d365, .35);
      hook.position.set(x, 2.5, .02);
      model.add(hook);
      const gem = glow(new THREE.OctahedronGeometry(.07, 0), 0x8de5ff, .4);
      gem.position.set(x, 2.38, .06);
      model.add(gem);
    });
  }
}

function addOutfit(model: THREE.Group, outfit: string) {
  const outfitColor = getAvatarOutfitColor(outfit);
  const lightTrim = new THREE.Color(outfitColor).offsetHSL(.01, -.12, .16).getHex();
  const darkTrim = new THREE.Color(outfitColor).offsetHSL(-.015, .05, -.2).getHex();
  const chestPanel = mesh(new THREE.BoxGeometry(.58, .62, .065), outfitColor, .56, .08);
  chestPanel.position.set(0, 1.76, .325);
  model.add(chestPanel);
  const hem = mesh(new THREE.BoxGeometry(.66, .075, .085), darkTrim, .5, .12);
  hem.position.set(0, 1.36, .28);
  model.add(hem);
  [-.18, .18].forEach(x => {
    const collar = mesh(new THREE.BoxGeometry(.16, .23, .07), lightTrim, .62);
    collar.position.set(x, 2.05, .33);
    collar.rotation.z = x < 0 ? -.36 : .36;
    model.add(collar);
  });
  if (!outfit || outfit === "camiseta_beco") {
    const emblem = glow(new THREE.CircleGeometry(.105, 12), 0xffd86c, .45);
    emblem.position.set(0, 1.78, .37);
    model.add(emblem);
  }
  if (outfit === "jaqueta_neon") {
    const zipper = glow(new THREE.BoxGeometry(.035, .68, .075), 0x81f7ee, .6);
    zipper.position.set(0, 1.77, .37);
    model.add(zipper);
    [-.27, .27].forEach(x => {
      const stripe = glow(new THREE.BoxGeometry(.07, .8, .07), 0xffd45e, .8);
      stripe.position.set(x, 1.74, .33);
      model.add(stripe);
    });
  } else if (outfit === "terno_suspeito") {
    const shirt = mesh(new THREE.BoxGeometry(.25, .64, .075), 0xf4eddf, .72);
    shirt.position.set(0, 1.78, .37);
    model.add(shirt);
    const tie = mesh(new THREE.ConeGeometry(.1, .48, 4), 0xa33b4d, .45);
    tie.position.set(0, 1.72, .34);
    tie.rotation.x = Math.PI;
    model.add(tie);
    [-1, 1].forEach(side => {
      const lapel = mesh(new THREE.BoxGeometry(.22, .6, .06), 0x1e2a45, .52);
      lapel.position.set(side * .2, 1.88, .34);
      lapel.rotation.z = side * -.33;
      model.add(lapel);
    });
  } else if (outfit === "moletom_nuvem") {
    const hood = mesh(new THREE.TorusGeometry(.38, .09, 8, 20), 0xd8efff, .86);
    hood.rotation.x = Math.PI / 2;
    hood.position.set(0, 2.1, -.02);
    model.add(hood);
    const pocket = mesh(new THREE.BoxGeometry(.45, .22, .06), 0xd8efff, .86);
    pocket.position.set(0, 1.48, .34);
    model.add(pocket);
  } else if (outfit === "camisa_xadrez") {
    [-.2, 0, .2].forEach(x => {
      const line = mesh(new THREE.BoxGeometry(.045, .9, .055), 0xf5c7a9, .7);
      line.position.set(x, 1.75, .34);
      model.add(line);
    });
    [-.22, .08, .36].forEach(y => {
      const line = mesh(new THREE.BoxGeometry(.76, .045, .055), 0x512b3d, .7);
      line.position.set(0, 1.55 + y, .345);
      model.add(line);
    });
  } else if (outfit === "uniforme_arcade") {
    const panel = glow(new THREE.BoxGeometry(.43, .36, .08), 0x182238, 1.1);
    panel.position.set(0, 1.75, .36);
    model.add(panel);
    const coin = glow(new THREE.SphereGeometry(.055, 10, 8), 0xffe15c, .9);
    coin.position.set(.1, 1.75, .42);
    model.add(coin);
  } else if (outfit === "vestido_aurora") {
    const skirt = mesh(new THREE.CylinderGeometry(.76, .46, .86, 6), 0xd96ea8, .78);
    skirt.position.set(0, 1.05, 0);
    model.add(skirt);
    const sash = mesh(new THREE.TorusGeometry(.5, .055, 8, 20), 0xf9d5a0, .48, .2);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 1.43;
    model.add(sash);
  } else if (outfit === "macacao_oficina") {
    const bib = mesh(new THREE.BoxGeometry(.46, .5, .09), 0x4d627e, .58, .12);
    bib.position.set(0, 1.75, .38);
    model.add(bib);
    [-.18, .18].forEach(x => {
      const strap = mesh(new THREE.BoxGeometry(.075, .67, .08), 0x4d627e, .58, .12);
      strap.position.set(x, 1.82, .34);
      model.add(strap);
    });
    const pocket = mesh(new THREE.BoxGeometry(.26, .14, .055), 0x33455d, .58);
    pocket.position.set(0, 1.61, .445);
    model.add(pocket);
    [-.18, .18].forEach(x => {
      const button = mesh(new THREE.SphereGeometry(.045, 8, 6), 0xf0be62, .34, .42);
      button.position.set(x, 2.06, .43);
      model.add(button);
    });
  } else if (outfit === "jaqueta_colegial") {
    [-.29, .29].forEach(x => {
      const stripe = mesh(new THREE.BoxGeometry(.08, .86, .06), 0xf7e5c1, .7);
      stripe.position.set(x, 1.75, .34);
      model.add(stripe);
    });
    const crest = glow(new THREE.SphereGeometry(.09, 10, 8), 0xf4c857, .65);
    crest.position.set(-.17, 1.85, .39);
    model.add(crest);
  } else if (outfit === "traje_astral") {
    const chest = glow(new THREE.BoxGeometry(.45, .38, .1), 0x111b39, 1.1);
    chest.position.set(0, 1.78, .36);
    model.add(chest);
    [-.12, .12].forEach(x => {
      const light = glow(new THREE.SphereGeometry(.05, 8, 6), x < 0 ? 0xffdc75 : 0xf58cff, .9);
      light.position.set(x, 1.78, .43);
      model.add(light);
    });
  } else if (outfit === "saia_plissada") {
    const skirt = mesh(new THREE.CylinderGeometry(.46, .62, .62, 8), 0xf08ab9, .72);
    skirt.position.set(0, 1.07, 0);
    model.add(skirt);
    const waistband = mesh(new THREE.CylinderGeometry(.47, .47, .07, 8), 0xffdf7d, .48);
    waistband.position.y = 1.4;
    model.add(waistband);
  } else if (outfit === "conjunto_lilas") {
    const cropHem = mesh(new THREE.BoxGeometry(.68, .08, .09), 0xf3d8ff, .5);
    cropHem.position.set(0, 1.55, .34);
    model.add(cropHem);
    const bow = mesh(new THREE.SphereGeometry(.1, 10, 8), 0xffd66e, .5);
    bow.position.set(.18, 1.65, .4);
    model.add(bow);
    const shorts = mesh(new THREE.BoxGeometry(.7, .28, .58), 0x7653b7, .66);
    shorts.position.set(0, 1.2, 0);
    model.add(shorts);
  } else if (outfit === "vestido_noite") {
    const skirt = mesh(new THREE.ConeGeometry(.7, .78, 8), 0x2f3267, .62);
    skirt.position.set(0, .98, 0);
    model.add(skirt);
    [[-.26, 1.2], [.12, 1.04], [.28, .84]].forEach(([x, y]) => {
      const star = glow(new THREE.DodecahedronGeometry(.052, 0), 0xffe084, .48);
      star.position.set(x, y, .54);
      model.add(star);
    });
  }
}

function getBlockyHairColor(hairId = "") {
  if (hairId.includes("azul")) return 0x3c77c9;
  if (hairId.includes("rosa") || hairId.includes("marias")) return 0xd45d8b;
  if (hairId.includes("lilas")) return 0x8061c7;
  if (hairId.includes("trancas")) return 0x3b2a39;
  if (hairId.includes("caos")) return 0x44334e;
  if (hairId.includes("cacheado")) return 0x35261f;
  return 0x32272c;
}

function addBlock(parent: THREE.Object3D, width: number, height: number, depth: number, color: number, x = 0, y = 0, z = 0) {
  const part = mesh(new THREE.BoxGeometry(width, height, depth), color, 0.68, 0.03);
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function addBlockyWardrobe(character: THREE.Group, avatar: HousePlayer["avatar"] | undefined) {
  const slots = avatar?.slots || {};
  const bodyId = slots.body || "corpo_beco";
  const torso = character.getObjectByName("torso");
  const head = character.getObjectByName("head");
  const leftArm = character.getObjectByName("arm-left");
  const rightArm = character.getObjectByName("arm-right");
  const leftLeg = character.getObjectByName("leg-left");
  const rightLeg = character.getObjectByName("leg-right");
  if (!torso || !head || !leftArm || !rightArm || !leftLeg || !rightLeg) return;
  const headBounds = new THREE.Box3().setFromObject(head);
  const headCenter = headBounds.getCenter(new THREE.Vector3());
  const headBase = new THREE.Vector3(headCenter.x, headBounds.min.y, headCenter.z);
  character.worldToLocal(headBase);
  const headAnchor = new THREE.Group();
  headAnchor.name = "Beco head anchor";
  headAnchor.position.copy(headBase);
  character.add(headAnchor);

  const outfit = getAvatarOutfitColor(slots.outfit || "camiseta_beco");
  const trim = new THREE.Color(outfit).offsetHSL(.01, -.1, .16).getHex();
  const dark = new THREE.Color(outfit).offsetHSL(-.02, .08, -.22).getHex();
  const shirt = addBlock(torso, .82, .82, .62, outfit, 0, .75);
  shirt.name = "Beco outfit";
  addBlock(leftArm, .43, .64, .46, outfit, .2, -.44);
  addBlock(rightArm, .43, .64, .46, outfit, -.2, -.44);
  [leftLeg, rightLeg].forEach(legBone => {
    addBlock(legBone, .44, .84, .5, dark, 0, -.55);
    addBlock(legBone, .49, .2, .63, 0x1f2131, 0, -1.02, .08);
  });
  addBlock(torso, .84, .075, .65, dark, 0, .38);
  addBlock(torso, .44, .055, .026, trim, 0, 1.1, .325);

  switch (slots.outfit || "camiseta_beco") {
    case "jaqueta_neon":
      [-.27, .27].forEach(x => {
        const stripe = glow(new THREE.BoxGeometry(.075, .72, .018), 0x7df6e5, .55);
        stripe.position.set(x, .75, .331);
        torso.add(stripe);
      });
      break;
    case "terno_suspeito":
      addBlock(torso, .23, .68, .02, 0xf5eadb, 0, .78, .333);
      [-1, 1].forEach(side => {
        const lapel = addBlock(torso, .21, .56, .03, 0x1e2a45, side * .22, .88, .35);
        lapel.rotation.z = side * -.3;
      });
      addBlock(torso, .09, .3, .025, 0xa33b4d, 0, .65, .355).rotation.z = Math.PI;
      break;
    case "moletom_nuvem": {
      const hood = mesh(new THREE.TorusGeometry(.3, .065, 6, 18), 0xd8efff, .72);
      hood.rotation.x = Math.PI / 2;
      hood.position.set(0, 1.12, 0);
      torso.add(hood);
      addBlock(torso, .42, .18, .025, 0xd8efff, 0, .59, .35);
      break;
    }
    case "camisa_xadrez":
      [-.22, 0, .22].forEach(x => addBlock(torso, .045, .73, .02, 0xf4c3a7, x, .75, .35));
      [.52, .78, 1.02].forEach(y => addBlock(torso, .75, .045, .02, 0x512b3d, 0, y, .35));
      break;
    case "uniforme_arcade":
      addBlock(torso, .58, .13, .024, 0xf9d45b, 0, .93, .35);
      [-.28, .28].forEach(x => addBlock(torso, .07, .73, .02, 0x183757, x, .75, .35));
      break;
    case "vestido_aurora": {
      const skirt = mesh(new THREE.ConeGeometry(.66, .54, 4), 0xf5a4be, .7);
      skirt.position.set(0, .22, 0);
      skirt.rotation.y = Math.PI / 4;
      torso.add(skirt);
      addBlock(torso, .6, .07, .025, 0xffd866, 0, .45, .35);
      break;
    }
    case "macacao_oficina":
      addBlock(torso, .46, .52, .025, 0x4d627e, 0, .67, .35);
      [-.22, .22].forEach(x => addBlock(torso, .08, .65, .025, 0x4d627e, x, .78, .35));
      addBlock(torso, .11, .11, .03, 0xf6d365, 0, .8, .37);
      break;
    case "jaqueta_colegial":
      addBlock(torso, .68, .09, .03, 0xf4eddf, 0, 1.05, .35);
      [-.29, .29].forEach(x => addBlock(torso, .07, .7, .02, 0xf4eddf, x, .75, .35));
      break;
    case "traje_astral": {
      const crest = glow(new THREE.OctahedronGeometry(.11, 0), 0x92dfff, .7);
      crest.position.set(0, .85, .39);
      torso.add(crest);
      [-.23, .23].forEach(x => addBlock(torso, .055, .72, .02, 0x9a6cff, x, .75, .35));
      break;
    }
    case "saia_plissada": {
      const skirt = mesh(new THREE.CylinderGeometry(.46, .62, .62, 4), 0xf18bb9, .68);
      skirt.position.set(0, .07, 0);
      skirt.rotation.y = Math.PI / 4;
      torso.add(skirt);
      addBlock(torso, .74, .07, .6, 0xffdc7d, 0, .4);
      break;
    }
    case "conjunto_lilas":
      addBlock(torso, .68, .075, .026, 0xf3d9ff, 0, .54, .35);
      addBlock(torso, .7, .25, .56, 0x7256af, 0, .18, 0);
      addBlock(torso, .1, .1, .025, 0xffd96f, .18, .7, .37);
      break;
    case "vestido_noite": {
      const skirt = mesh(new THREE.ConeGeometry(.7, .76, 4), 0x303568, .66);
      skirt.position.set(0, .04, 0);
      skirt.rotation.y = Math.PI / 4;
      torso.add(skirt);
      [[-.24, .29], [.13, .15], [.29, .02]].forEach(([x, y]) => {
        const star = glow(new THREE.DodecahedronGeometry(.04, 0), 0xffe283, .42);
        star.position.set(x, y, .39);
        torso.add(star);
      });
      break;
    }
    default: {
      const patch = glow(new THREE.CircleGeometry(.105, 12), trim, .28);
      patch.position.set(0, .78, .335);
      torso.add(patch);
    }
  }

  const hairId = slots.hair_face || "";
  const hairColor = bodyId === "corpo_beca" && hairId === "base_face" ? 0x7b4f45 : getBlockyHairColor(hairId);
  const hair = new THREE.Group();
  hair.name = "Beco hair";
  headAnchor.add(hair);
  if (bodyId === "corpo_beca" && hairId === "base_face") {
    addBlock(hair, .92, .26, .88, hairColor, 0, .88);
    [-.48, .48].forEach(x => addBlock(hair, .18, .68, .24, hairColor, x, .48));
    addBlock(hair, .46, .16, .08, hairColor, -.1, .68, .47).rotation.z = -.08;
  } else if (hairId !== "cabelo_longo_lilas") {
    addBlock(hair, .88, .24, .84, hairColor, 0, .88);
  }
  switch (hairId) {
    case "cabelo_cacheado":
      [-.3, 0, .3].forEach((x, index) => {
        const curl = mesh(new THREE.DodecahedronGeometry(.2, 0), hairColor, .78);
        curl.position.set(x, .98 + (index % 2) * .1, .29);
        hair.add(curl);
      });
      break;
    case "cabelo_caos":
      [-.27, 0, .27].forEach((x, index) => {
        const spike = mesh(new THREE.ConeGeometry(.16, .38 + (index % 2) * .1, 4), hairColor, .72);
        spike.position.set(x, 1.14, .04);
        hair.add(spike);
      });
      break;
    case "franja_azul":
      [-.23, 0, .23].forEach(x => addBlock(hair, .2, .22, .08, 0x3f83d8, x, .68, .46));
      break;
    case "bone_beco":
      addBlock(hair, .94, .18, .88, 0x6f54d7, 0, .9);
      addBlock(hair, .9, .09, .3, 0x6f54d7, 0, .84, .49);
      break;
    case "bandana_pixel":
      addBlock(hair, .92, .11, .88, 0xef5d6f, 0, .76);
      addBlock(hair, .16, .22, .1, 0xef5d6f, .5, .73, .05).rotation.z = -.55;
      break;
    case "cabelo_rosa":
      [-.5, .5].forEach(x => {
        addBlock(hair, .18, .43, .22, 0xd45d8b, x, .62, -.06);
        const tip = mesh(new THREE.DodecahedronGeometry(.16, 0), 0xf08bb1, .72);
        tip.position.set(x, .37, -.06);
        hair.add(tip);
      });
      break;
    case "cabelo_longo_lilas":
      {
        const cap = mesh(new THREE.SphereGeometry(.54, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hairColor, .74);
        cap.position.set(0, .56, 0);
        hair.add(cap);
      }
      [-.45, .45].forEach(x => {
        const lock = mesh(new THREE.CapsuleGeometry(.12, .54, 5, 8), hairColor, .74);
        lock.position.set(x, .24, .25);
        lock.rotation.z = x * -.08;
        hair.add(lock);
      });
      [-.16, 0, .16].forEach(x => {
        const fringe = mesh(new THREE.SphereGeometry(.13, 10, 7), 0xb391ee, .72);
        fringe.scale.set(.9, .52, .28);
        fringe.position.set(x, .7, .49);
        hair.add(fringe);
      });
      break;
    case "marias_chiquinhas":
      [-.58, .58].forEach(x => {
        const tail = mesh(new THREE.DodecahedronGeometry(.23, 0), hairColor, .74);
        tail.position.set(x, .62, .02);
        hair.add(tail);
        const ribbon = glow(new THREE.TorusGeometry(.09, .02, 6, 12), 0x82f5ef, .35);
        ribbon.position.set(x * .8, .65, .25);
        hair.add(ribbon);
      });
      break;
    case "trancas_aurora":
      [-.4, -.14, .14, .4].forEach((x, index) => {
        const braid = addBlock(hair, .1, .72, .13, index % 2 ? 0x7256a8 : hairColor, x, .25, .05);
        braid.rotation.z = x * -.12;
      });
      break;
    case "chapeu_pescador": {
      const crown = mesh(new THREE.CylinderGeometry(.34, .4, .28, 8), 0xd8b46d, .8);
      crown.position.y = 1.04;
      hair.add(crown);
      const brim = mesh(new THREE.CylinderGeometry(.58, .58, .06, 12), 0xd8b46d, .8);
      brim.position.y = .87;
      hair.add(brim);
      break;
    }
  }

  if (bodyId === "corpo_beca") {
    [-.31, .31].forEach(x => {
      addBlock(headAnchor, .16, .055, .025, 0xf190af, x, .18, .48);
      const lash = addBlock(headAnchor, .07, .018, .024, 0x32272c, x + Math.sign(x) * .1, .51, .48);
      lash.rotation.z = x < 0 ? -.32 : .32;
    });
  }

  if (hairId.includes("oculos")) {
    [-.2, .2].forEach(x => {
      const frame = addBlock(headAnchor, .28, .19, .055, 0x27304d, x, .42, .43);
      const lens = glow(new THREE.BoxGeometry(.18, .1, .012), 0x84e4ff, .16);
      lens.position.set(x, .42, .463);
      headAnchor.add(lens);
      frame.rotation.z = x * -.04;
    });
    addBlock(headAnchor, .12, .035, .055, 0x27304d, 0, .42, .43);
  } else if (hairId.includes("mascara")) {
    addBlock(headAnchor, .78, .35, .075, 0x4c396f, 0, .4, .44);
    [-.21, .21].forEach(x => addBlock(headAnchor, .17, .075, .018, 0xf7d881, x, .43, .487));
    const jewel = glow(new THREE.DodecahedronGeometry(.055, 0), 0xf6d365, .5);
    jewel.position.set(0, .27, .49);
    headAnchor.add(jewel);
  }

  switch (slots.optional_accessory || "sem_acessorio") {
    case "laco_neon":
      [-.18, .18].forEach(x => {
        const loop = mesh(new THREE.DodecahedronGeometry(.16, 0), 0xf56fa8, .62);
        loop.scale.set(1.2, .72, .42);
        loop.position.set(x, 1.0, .34);
        headAnchor.add(loop);
      });
      {
        const knot = glow(new THREE.SphereGeometry(.06, 8, 6), 0xffe27b, .4);
        knot.position.set(0, 1.0, .48);
        headAnchor.add(knot);
      }
      break;
    case "tiara_lua": {
      const band = mesh(new THREE.TorusGeometry(.43, .028, 6, 16, Math.PI), 0xbda7ff, .38);
      band.rotation.z = Math.PI;
      band.position.set(0, .9, 0);
      headAnchor.add(band);
      const moon = glow(new THREE.CircleGeometry(.075, 12), 0xffe481, .4);
      moon.position.set(0, 1.12, .28);
      headAnchor.add(moon);
      break;
    }
    case "corrente_brilho": {
      const chainPoints: Array<[number, number]> = [[-.3, 1.12], [-.24, 1.04], [-.16, .98], [-.08, .94], [0, .92], [.08, .94], [.16, .98], [.24, 1.04], [.3, 1.12]];
      chainPoints.forEach(([x, y], index) => {
        const link = mesh(new THREE.TorusGeometry(.027, .008, 6, 10), 0xf6d365, .3, .7);
        link.position.set(x, y, .38);
        link.rotation.z = index % 2 ? Math.PI / 2 : 0;
        torso.add(link);
      });
      const pendant = glow(new THREE.DodecahedronGeometry(.055, 0), 0xffdf78, .38);
      pendant.position.set(0, .84, .42);
      torso.add(pendant);
      break;
    }
    case "coroa_papel":
      [-.26, 0, .26].forEach((x, index) => {
        const spike = mesh(new THREE.ConeGeometry(.14, .32 + (index === 1 ? .1 : 0), 4), 0xf6d365, .76);
        spike.position.set(x, 1.0, 0);
        headAnchor.add(spike);
      });
      break;
    case "fones_neon": {
      const band = mesh(new THREE.TorusGeometry(.43, .055, 6, 16, Math.PI), 0x8b5cf6, .52);
      band.position.set(0, .57, 0);
      headAnchor.add(band);
      [-.46, .46].forEach(x => addBlock(headAnchor, .15, .28, .18, 0x64e9ed, x, .34));
      break;
    }
    case "mochila_lateral":
      addBlock(torso, .67, .66, .22, 0x5378af, 0, .7, -.4);
      addBlock(torso, .49, .1, .035, 0x9bbfec, 0, .86, -.53);
      [-.31, .31].forEach(x => addBlock(torso, .075, .72, .035, 0x405b8a, x, .73, .35));
      break;
    case "asas_pixel":
      [-1, 1].forEach(side => {
        const wing = addBlock(torso, .5, .42, .07, 0xe7f0ff, side * .52, .73, -.36);
        wing.rotation.z = side * -.28;
        const feather = glow(new THREE.BoxGeometry(.32, .05, .025), 0x9dd9ff, .32);
        feather.position.set(side * .52, .72, -.41);
        feather.rotation.z = side * -.28;
        torso.add(feather);
      });
      break;
    case "cachecol_estrelas": {
      const scarf = mesh(new THREE.TorusGeometry(.34, .055, 6, 16), 0xef78a5, .65);
      scarf.rotation.x = Math.PI / 2;
      scarf.position.set(0, .48, .01);
      torso.add(scarf);
      const tail = addBlock(torso, .14, .47, .08, 0x7255c7, .22, .22, .36);
      tail.rotation.z = -.16;
      [0, .12, .24].forEach((y, index) => {
        const star = glow(new THREE.DodecahedronGeometry(.035, 0), 0xf6d365, .45);
        star.position.set(.22, .42 - y, .41);
        star.rotation.z = index * .4;
        torso.add(star);
      });
      break;
    }
    case "bolsa_cogumelo": {
      addBlock(torso, .055, .92, .025, 0xf4d7a1, .14, .72, .36).rotation.z = -.42;
      const bag = mesh(new THREE.SphereGeometry(.18, 12, 8), 0xf17d81, .68);
      bag.scale.set(1, .82, .55);
      bag.position.set(.34, .33, .34);
      torso.add(bag);
      addBlock(torso, .2, .09, .02, 0xfff1dc, .34, .45, .45);
      break;
    }
    case "bolsa_estelar": {
      addBlock(torso, .055, .9, .025, 0x8d6ada, .14, .72, .36).rotation.z = -.42;
      const bag = mesh(new THREE.BoxGeometry(.37, .3, .16), 0x384172, .64);
      bag.position.set(.34, .32, .34);
      torso.add(bag);
      [[.25, .37], [.38, .29], [.43, .39]].forEach(([x, y]) => {
        const star = glow(new THREE.DodecahedronGeometry(.035, 0), 0xffe281, .42);
        star.position.set(x, y, .44);
        torso.add(star);
      });
      break;
    }
    case "brincos_pixel":
      [-.52, .52].forEach(x => {
        const hook = mesh(new THREE.TorusGeometry(.055, .01, 6, 10), 0xf6d365, .36);
        hook.position.set(x, .26, .05);
        headAnchor.add(hook);
        const gem = glow(new THREE.OctahedronGeometry(.055, 0), 0x8fe8ff, .42);
        gem.position.set(x, .12, .08);
        headAnchor.add(gem);
      });
      break;
    case "aura_vinil": {
      const disc = mesh(new THREE.TorusGeometry(.75, .06, 8, 22), 0x86d7f6, .44);
      disc.position.set(0, .76, -.34);
      torso.add(disc);
      const core = glow(new THREE.CircleGeometry(.12, 12), 0xc565f5, .34);
      core.position.set(0, .76, -.4);
      torso.add(core);
      break;
    }
  }
}

function playBlockyAction(runtime: BlockyAvatarRuntime, name: string) {
  const actionName = name === "idle" ? "static" : name;
  const next = runtime.actions.get(actionName) || runtime.actions.get("static") || runtime.actions.get("idle");
  if (!next || next === runtime.active) return;
  next.reset().setEffectiveWeight(1).setEffectiveTimeScale(actionName === "walk" ? 1.15 : 1);
  next.setLoop(actionName === "static" ? THREE.LoopOnce : THREE.LoopRepeat, actionName === "static" ? 1 : Infinity);
  next.clampWhenFinished = actionName === "static";
  next.fadeIn(.16).play();
  runtime.active?.fadeOut(.16);
  runtime.active = next;
}

function hydrateBlockyAvatar(rig: Avatar3DRig, avatar: HousePlayer["avatar"] | undefined) {
  loadBlockyTemplate(avatar?.slots?.body)
    .then(template => {
      if (rig.disposed) return;
      const character = cloneSkeleton(template.scene) as THREE.Group;
      character.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        object.userData.blockyBaseAsset = true;
      });
      character.updateMatrixWorld(true);
      const rawBounds = new THREE.Box3().setFromObject(character);
      const rawHeight = Math.max(rawBounds.getSize(new THREE.Vector3()).y, .01);
      character.scale.setScalar(3.05 / rawHeight);
      character.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(character);
      character.position.y = -floorContactOffset - scaledBounds.min.y;
      character.updateMatrixWorld(true);
      addBlockyWardrobe(character, avatar);
      const mixer = new THREE.AnimationMixer(character);
      const actions = new Map(template.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
      const runtime: BlockyAvatarRuntime = { mixer, actions };
      playBlockyAction(runtime, "idle");
      rig.model.add(character);
      rig.blocky = runtime;
      rig.fallback.visible = false;
    })
    .catch(() => {
      // O rig procedural continua disponível se o asset não puder ser carregado.
    });
}

function createVoiceIndicator() {
  const group = new THREE.Group();
  group.position.set(0, 4.02, 0);
  [-.18, 0, .18].forEach((x, index) => {
    const dot = glow(new THREE.SphereGeometry(.065, 10, 8), 0x72efff, 1.3);
    dot.position.set(x, index === 1 ? .08 : 0, 0);
    group.add(dot);
  });
  group.visible = false;
  return group;
}

export function createAvatar3D(avatar: HousePlayer["avatar"] | undefined, label: string) {
  const slots = avatar?.slots || {};
  const outfit = getAvatarOutfitColor(slots.outfit);
  const legOutfit = slots.outfit === "macacao_oficina" ? 0x4d627e : outfit;
  const root = new THREE.Group();
  const model = new THREE.Group();
  const fallback = new THREE.Group();
  root.add(model);
  model.add(fallback);
  const torso = mesh(new THREE.CapsuleGeometry(0.46, 0.7, 6, 14), outfit, 0.62);
  torso.scale.z = 0.78;
  torso.position.y = 1.75;
  fallback.add(torso);
  const belt = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 16), 0x2f2d45, 0.48, 0.18);
  belt.position.y = 1.34;
  fallback.add(belt);
  const neck = mesh(new THREE.CylinderGeometry(.16, .18, .22, 12), skin, .76);
  neck.position.y = 2.16;
  fallback.add(neck);
  const head = mesh(new THREE.SphereGeometry(0.53, 26, 18), skin, 0.78);
  head.scale.z = .92;
  head.position.y = 2.58;
  fallback.add(head);
  addHair(fallback, slots.hair_face, slots.body);
  addFace(fallback, slots.hair_face, slots.body);
  addOutfit(fallback, slots.outfit || "camiseta_beco");
  addAccessory(fallback, slots.optional_accessory);
  const leftArm = limb(fallback, -0.61, 2.05, skin);
  const rightArm = limb(fallback, 0.61, 2.05, skin);
  addSleeve(leftArm, outfit);
  addSleeve(rightArm, outfit);
  leftArm.rotation.z = -0.12;
  rightArm.rotation.z = 0.12;
  const left = leg(fallback, -0.23, legOutfit);
  const right = leg(fallback, 0.23, legOutfit);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.68, 32), new THREE.MeshBasicMaterial({ color: 0x090810, transparent: true, opacity: 0.34, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = 0.42;
  shadow.position.y = 0.008;
  root.add(shadow);
  const voiceIndicator = createVoiceIndicator();
  root.add(voiceIndicator);
  model.add(labelSprite(label, label === "VOCÊ"));
  const rig = {
    root, model, leftArm, rightArm, leftLeg: left.hip, rightLeg: right.hip,
    leftKnee: left.knee, rightKnee: right.knee, shadow, voiceIndicator, fallback,
    visualKey: getAvatarVisualKey(avatar), walking: 0, seated: 0,
  } satisfies Avatar3DRig;
  hydrateBlockyAvatar(rig, avatar);
  return rig;
}

export function animateAvatar3D(rig: Avatar3DRig, elapsed: number, moving: boolean, seatedAmount: number, reducedMotion = false, delta = 1 / 60, speaking = false) {
  rig.walking = THREE.MathUtils.damp(rig.walking, moving ? 1 : 0, 8.5, delta);
  rig.seated = THREE.MathUtils.damp(rig.seated, seatedAmount, reducedMotion ? 20 : 7, delta);
  const phase = elapsed * 8.1;
  const walk = Math.sin(phase) * 0.44 * rig.walking;
  const leftLift = Math.max(0, -Math.sin(phase)) * .24 * rig.walking;
  const rightLift = Math.max(0, Math.sin(phase)) * .24 * rig.walking;
  const sit = rig.seated;
  if (rig.blocky) {
    rig.blocky.mixer.update(delta);
    playBlockyAction(rig.blocky, sit > .55 ? "sit" : moving ? "walk" : "idle");
  } else {
    rig.leftArm.rotation.x = walk * .92 - sit * .72;
    rig.rightArm.rotation.x = -walk * .92 - sit * .72;
    rig.leftLeg.rotation.x = -walk * .96 - sit * Math.PI / 2;
    rig.rightLeg.rotation.x = walk * .96 - sit * Math.PI / 2;
    rig.leftKnee.rotation.x = leftLift + sit * Math.PI / 2;
    rig.rightKnee.rotation.x = rightLift + sit * Math.PI / 2;
  }
  const animatedSit = rig.blocky ? 0 : sit;
  rig.model.position.y = floorContactOffset - animatedSit * seatedModelDrop + (reducedMotion ? 0 : Math.abs(Math.sin(phase * 2)) * .026 * rig.walking);
  rig.model.rotation.y = Math.sin(phase) * .035 * rig.walking;
  rig.model.rotation.z = Math.sin(phase) * .018 * rig.walking;
  rig.shadow.scale.setScalar(THREE.MathUtils.lerp(1, 1.2, sit));
  rig.voiceIndicator.visible = speaking;
  if (speaking) {
    const pulse = .9 + Math.sin(elapsed * 13) * .16;
    rig.voiceIndicator.scale.setScalar(pulse);
  }
}

export function disposeAvatar3D(rig: Avatar3DRig) {
  rig.disposed = true;
  rig.root.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
      const sharedCharacterGeometry = Boolean(object.userData.blockyBaseAsset);
      if (!sharedCharacterGeometry) object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(value => {
        if (!sharedCharacterGeometry) (value as THREE.MeshStandardMaterial).map?.dispose();
        value.dispose();
      });
    }
  });
}
