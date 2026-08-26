import type { AvatarState } from "@/lib/types";
import { getAvatarOutfitColor } from "./avatarAppearance.js";

type AvatarFigureProps = {
  avatar: Pick<AvatarState, "slots">;
  compact?: boolean;
  label?: string;
};

const OUTLINE = "#21172f";

function toCssColor(color: number) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function BackAccessory({ id }: { id: string }) {
  if (id === "asas_pixel") return <g data-avatar-item={id}>
    <path d="M57 119H35V98H19V72H37V86H53z" fill="#c8f1ff" stroke={OUTLINE} strokeWidth="5" strokeLinejoin="round" />
    <path d="M123 119h22V98h16V72h-18V86h-16z" fill="#d9c8ff" stroke={OUTLINE} strokeWidth="5" strokeLinejoin="round" />
    <path d="M31 81h12m94 0h12" stroke="#fff" strokeWidth="4" />
  </g>;
  if (id === "aura_vinil") return <g data-avatar-item={id} fill="none" strokeLinecap="round">
    <ellipse cx="90" cy="119" rx="69" ry="91" stroke="#8cf4ff" strokeWidth="5" strokeDasharray="12 9" />
    <ellipse cx="90" cy="119" rx="60" ry="81" stroke="#f79cff" strokeWidth="3" strokeDasharray="7 12" />
    <path d="M25 127h12m106 0h12M41 56l9 9m80-9-9 9" stroke="#fff4a8" strokeWidth="4" />
  </g>;
  return null;
}

function OutfitDetails({ id }: { id: string }) {
  if (id === "jaqueta_neon") return <g data-avatar-item={id}>
    <path d="M64 116h52M90 116v61" fill="none" stroke="#ffe082" strokeWidth="4" strokeLinecap="round" />
    <path d="M64 118l20 21 6-18m26-3-20 21-6-18" fill="none" stroke="#ff82ba" strokeWidth="5" strokeLinejoin="round" />
  </g>;
  if (id === "terno_suspeito") return <g data-avatar-item={id}>
    <path d="M90 111v69M65 116l25 24 25-24" fill="none" stroke="#1e2a45" strokeWidth="5" strokeLinejoin="round" />
    <path d="M90 121l8 10-5 27h-6l-5-27z" fill="#a33b4d" stroke="#562331" strokeWidth="3" strokeLinejoin="round" />
  </g>;
  if (id === "moletom_nuvem") return <g data-avatar-item={id}>
    <path d="M69 113q21 18 42 0v17q-21 15-42 0z" fill="#d8efff" stroke="#38658b" strokeWidth="4" />
    <path d="M82 127v15m16-15v15" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    <path d="M74 158q16-12 32 0" fill="none" stroke="#d8efff" strokeWidth="5" />
  </g>;
  if (id === "camisa_xadrez") return <g data-avatar-item={id} stroke="#f5c7a9" strokeWidth="4" opacity=".9">
    <path d="M70 113v66m20-66v66m20-66v66M54 136h72m-72 21h72" />
    <path d="M90 111v69" stroke="#512b3d" />
  </g>;
  if (id === "uniforme_arcade") return <g data-avatar-item={id}>
    <path d="M56 116h68v18H56z" fill="#25254b" />
    <rect x="74" y="144" width="32" height="20" fill="#182238" stroke="#7dfff2" strokeWidth="3" />
    <path d="M80 154h8m-4-4v8m13-5h3" stroke="#ffe15c" strokeWidth="3" />
  </g>;
  if (id === "vestido_aurora") return <g data-avatar-item={id}>
    <path d="M61 111l29 29 29-29" fill="none" stroke="#ffd6c4" strokeWidth="5" />
    <path d="M62 151h56l14 38H48z" fill="#d96ea8" stroke={OUTLINE} strokeWidth="5" strokeLinejoin="round" />
    <path d="M64 161h52M59 175h62" stroke="#ffb38c" strokeWidth="5" />
  </g>;
  if (id === "macacao_oficina") return <g data-avatar-item={id}>
    <path d="M68 111v30h44v-30M76 141v37m28-37v37" fill="none" stroke="#5b4937" strokeWidth="6" />
    <rect x="80" y="126" width="20" height="13" fill="#f0be62" stroke="#5b4937" strokeWidth="3" />
    <path d="M84 132h12" stroke="#fff1b8" strokeWidth="3" />
  </g>;
  if (id === "jaqueta_colegial") return <g data-avatar-item={id}>
    <path d="M67 113v66m46-66v66" stroke="#f7e5c1" strokeWidth="7" />
    <path d="M90 112v68" stroke="#173d36" strokeWidth="4" />
    <path d="M77 132h12v14H77z" fill="#f4c857" stroke="#173d36" strokeWidth="3" />
    <path d="M78 138h10" stroke="#fff1a8" strokeWidth="3" />
  </g>;
  if (id === "traje_astral") return <g data-avatar-item={id}>
    <path d="M58 119h64M64 167h52" stroke="#9bc8ff" strokeWidth="5" />
    <rect x="76" y="127" width="28" height="24" rx="3" fill="#111b39" stroke="#6be3ff" strokeWidth="4" />
    <circle cx="86" cy="138" r="4" fill="#ffdc75" />
    <path d="M95 134h5m-5 8h5" stroke="#f58cff" strokeWidth="3" />
  </g>;
  return null;
}

function HairFace({ id }: { id: string }) {
  if (id === "cabelo_caos") return <g data-avatar-item={id}>
    <rect x="49" y="23" width="82" height="23" fill="#633b2b" stroke={OUTLINE} strokeWidth="6" />
    <rect x="53" y="39" width="18" height="24" fill="#633b2b" stroke={OUTLINE} strokeWidth="5" />
    <rect x="109" y="39" width="18" height="24" fill="#633b2b" stroke={OUTLINE} strokeWidth="5" />
    <path d="M62 30l6-8 6 8m28 0l6-8 6 8" fill="none" stroke="#4a2c20" strokeWidth="4" strokeLinejoin="round" />
  </g>;
  if (id === "oculos_pixel") return <g data-avatar-item={id}>
    <rect x="58" y="62" width="29" height="18" rx="3" fill="#1b1430" fillOpacity=".85" stroke="#5fe8ff" strokeWidth="4" />
    <rect x="94" y="62" width="29" height="18" rx="3" fill="#1b1430" fillOpacity=".85" stroke="#5fe8ff" strokeWidth="4" />
    <path d="M87 70h7M64 71h17m16 0h17" stroke="#8df2ff" strokeWidth="3" />
  </g>;
  if (id === "cabelo_cacheado") return <g data-avatar-item={id} fill="#412b43" stroke={OUTLINE} strokeWidth="5">
    <circle cx="57" cy="39" r="15" /><circle cx="76" cy="29" r="16" /><circle cx="96" cy="27" r="17" /><circle cx="117" cy="34" r="16" />
    <circle cx="127" cy="52" r="14" /><circle cx="53" cy="57" r="14" />
    <path d="M68 34q22 19 45 0" fill="#5d3a5e" />
  </g>;
  if (id === "franja_azul") return <g data-avatar-item={id}>
    <path d="M50 55V35q40-25 80 0v24l-17-16-13 20-13-20-16 19-9-19z" fill="#398bc6" stroke={OUTLINE} strokeWidth="6" strokeLinejoin="round" />
    <path d="M61 36q30-17 58 0" fill="none" stroke="#72c7ee" strokeWidth="5" />
  </g>;
  if (id === "bone_beco") return <g data-avatar-item={id}>
    <path d="M55 43V31q35-24 68 0v18H55z" fill="#7257d9" stroke={OUTLINE} strokeWidth="6" />
    <path d="M90 30v19h43q-11-13-28-15" fill="#513aa7" stroke={OUTLINE} strokeWidth="5" strokeLinejoin="round" />
    <rect x="68" y="28" width="14" height="8" fill="#ffd35c" />
  </g>;
  if (id === "bandana_pixel") return <g data-avatar-item={id}>
    <path d="M51 47q39-19 78 0v13q-39-17-78 0z" fill="#ef5d6f" stroke={OUTLINE} strokeWidth="5" />
    <path d="M124 50l20 5-14 10 14 10-23-6z" fill="#ef5d6f" stroke={OUTLINE} strokeWidth="4" strokeLinejoin="round" />
    <path d="M65 48h9m11-3h9m11 3h9" stroke="#ffd6a6" strokeWidth="4" />
  </g>;
  if (id === "mascara_misterio") return <g data-avatar-item={id}>
    <path d="M57 60q33-15 66 0l-7 28q-26 14-52 0z" fill="#5e3d8f" stroke={OUTLINE} strokeWidth="5" strokeLinejoin="round" />
    <path d="M69 70h15l-5 9H67zm27 0h15l2 9H101z" fill="#ffe6b0" />
    <path d="M63 62L49 56m68 6 14-6" stroke="#f1b2ff" strokeWidth="4" />
  </g>;
  if (id === "cabelo_rosa") return <g data-avatar-item={id}>
    <path d="M48 78V41q4-27 42-27t42 27v68h-21V50l-13-13-12 18-15-18-5 17v55H48z" fill="#e667a3" stroke={OUTLINE} strokeWidth="6" strokeLinejoin="round" />
    <path d="M58 39q32-22 63 0" fill="none" stroke="#ff9cc8" strokeWidth="5" />
  </g>;
  if (id === "chapeu_pescador") return <g data-avatar-item={id}>
    <path d="M61 42l8-29h42l9 29z" fill="#d5ad62" stroke={OUTLINE} strokeWidth="6" strokeLinejoin="round" />
    <path d="M47 40h86l12 15H35z" fill="#e7c878" stroke={OUTLINE} strokeWidth="6" strokeLinejoin="round" />
    <path d="M73 27h34" stroke="#765d3e" strokeWidth="5" />
  </g>;
  return null;
}

function FrontAccessory({ id }: { id: string }) {
  if (id === "coroa_papel") return <path data-avatar-item={id} d="M54 37l10-27 22 21L90 6l7 25 20-21 10 27v13H54z" fill="#ffe082" stroke="#754e24" strokeWidth="5" strokeLinejoin="round" />;
  if (id === "corrente_brilho") return <g data-avatar-item={id}>
    <path d="M67 117q23 29 46 0" fill="none" stroke="#ffd34f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="90" cy="139" r="7" fill="#ffd34f" stroke="#7b4d1b" strokeWidth="3" /><circle cx="88" cy="137" r="2" fill="#fff3b0" />
  </g>;
  if (id === "fones_neon") return <g data-avatar-item={id}>
    <path d="M52 70V55q0-34 38-34t38 34v15" fill="none" stroke="#6cf5ff" strokeWidth="7" />
    <rect x="45" y="62" width="17" height="30" rx="5" fill="#7638a8" stroke={OUTLINE} strokeWidth="5" />
    <rect x="118" y="62" width="17" height="30" rx="5" fill="#7638a8" stroke={OUTLINE} strokeWidth="5" />
    <path d="M50 70h8m64 0h8" stroke="#ff87d7" strokeWidth="5" />
  </g>;
  if (id === "mochila_lateral") return <g data-avatar-item={id}>
    <path d="M74 112q42 21 50 61" fill="none" stroke="#45324f" strokeWidth="6" />
    <path d="M112 145h28v35h-28z" fill="#db8c53" stroke={OUTLINE} strokeWidth="5" />
    <path d="M116 154h20" stroke="#ffe0a8" strokeWidth="4" /><rect x="122" y="165" width="8" height="7" fill="#6b4563" />
  </g>;
  if (id === "cachecol_estrelas") return <g data-avatar-item={id}>
    <path d="M63 108q27 19 54 0v17q-27 19-54 0z" fill="#7056c8" stroke={OUTLINE} strokeWidth="5" />
    <path d="M103 121l15 55-18 4-11-55z" fill="#7056c8" stroke={OUTLINE} strokeWidth="5" />
    <path d="M78 118l3 6 6 1-5 4 2 7-6-4-6 4 2-7-5-4 6-1z" fill="#ffe28b" />
  </g>;
  if (id === "bolsa_cogumelo") return <g data-avatar-item={id}>
    <path d="M64 113q48 24 57 70" fill="none" stroke="#6a3f47" strokeWidth="5" />
    <path d="M105 157q15-18 30 0v8h-30z" fill="#ee675f" stroke={OUTLINE} strokeWidth="4" />
    <path d="M109 164h22v22h-22z" fill="#f5d8a8" stroke={OUTLINE} strokeWidth="4" />
    <circle cx="115" cy="155" r="3" fill="#fff0d2" /><circle cx="127" cy="157" r="3" fill="#fff0d2" />
  </g>;
  return null;
}

export function AvatarFigure({ avatar, compact = false, label }: AvatarFigureProps) {
  const slots = avatar.slots as Record<string, string>;
  const outfit = slots.top || slots.outfit;
  const hair = slots.hair || slots.hair_face;
  const accessory = slots.headAccessory || slots.backAccessory || slots.optional_accessory;
  const bodyColor = toCssColor(getAvatarOutfitColor(outfit));

  return <div className={`avatar-figure ${compact ? "avatar-figure-compact" : ""}`} aria-label={label || "Avatar"}>
    <div className="avatar-figure-art">
      <svg viewBox="0 0 180 240" role="img" shapeRendering="crispEdges">
        <ellipse cx="90" cy="215" rx="49" ry="12" fill="#160d25" fillOpacity=".28" />
        <BackAccessory id={accessory} />
        <rect x="60" y="164" width="21" height="39" fill="#332f54" stroke={OUTLINE} strokeWidth="5" />
        <rect x="99" y="164" width="21" height="39" fill="#332f54" stroke={OUTLINE} strokeWidth="5" />
        <rect x="55" y="140" width="13" height="34" rx="4" fill={bodyColor} stroke={OUTLINE} strokeWidth="5" transform="rotate(9 61 157)" />
        <rect x="112" y="140" width="13" height="34" rx="4" fill={bodyColor} stroke={OUTLINE} strokeWidth="5" transform="rotate(-9 119 157)" />
        <rect x="53" y="111" width="74" height="69" rx="4" fill={bodyColor} stroke={OUTLINE} strokeWidth="6" />
        <rect x="110" y="111" width="17" height="69" rx="4" fill="#000" fillOpacity=".12" />
        <rect x="63" y="121" width="13" height="46" fill="#fff" fillOpacity=".18" />
        <OutfitDetails id={outfit} />
        <circle cx="90" cy="74" r="42" fill="#ffd6ba" stroke={OUTLINE} strokeWidth="6" />
        <circle cx="72" cy="86" r="6" fill="#f5a88c" fillOpacity=".55" />
        <circle cx="108" cy="86" r="6" fill="#f5a88c" fillOpacity=".55" />
        <path d="M72 70h12m12 0h12" stroke="#3a2740" strokeWidth="5" strokeLinecap="round" />
        <path d="M80 92q10 9 20 0" fill="none" stroke="#3a2740" strokeWidth="4" strokeLinecap="round" />
        <HairFace id={hair} />
        <FrontAccessory id={accessory} />
      </svg>
    </div>
    {label && !compact && <span>{label}</span>}
  </div>;
}
