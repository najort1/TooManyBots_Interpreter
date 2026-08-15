import type { AvatarState } from "@/lib/types";

type AvatarFigureProps = {
  avatar: Pick<AvatarState, "slots">;
  label?: string;
};

export function AvatarFigure({ avatar, label }: AvatarFigureProps) {
  const outfit = avatar.slots.outfit;
  const hair = avatar.slots.hair_face;
  const accessory = avatar.slots.optional_accessory;
  const bodyColor = outfit === "terno_suspeito" ? "#344563" : outfit === "jaqueta_neon" ? "#f15099" : "#7b5ce5";

  return <div className="avatar-figure" aria-label={label || "Avatar"}>
    <div className="avatar-figure-art">
      <svg viewBox="0 0 180 240" role="img" shapeRendering="crispEdges">
        <ellipse cx="90" cy="215" rx="49" ry="12" fill="#160d25" fillOpacity=".28" />
        <rect x="60" y="164" width="21" height="39" fill="#332f54" stroke="#21172f" strokeWidth="5" />
        <rect x="99" y="164" width="21" height="39" fill="#332f54" stroke="#21172f" strokeWidth="5" />
        <rect x="55" y="140" width="13" height="34" rx="4" fill={bodyColor} stroke="#21172f" strokeWidth="5" transform="rotate(9 61 157)" />
        <rect x="112" y="140" width="13" height="34" rx="4" fill={bodyColor} stroke="#21172f" strokeWidth="5" transform="rotate(-9 119 157)" />
        <rect x="53" y="111" width="74" height="69" rx="4" fill={bodyColor} stroke="#21172f" strokeWidth="6" />
        <rect x="110" y="111" width="17" height="69" rx="4" fill="#000" fillOpacity=".12" />
        <rect x="63" y="121" width="13" height="46" fill="#fff" fillOpacity=".18" />
        {outfit === "jaqueta_neon" && <path d="M66 118h48" stroke="#ffe082" strokeWidth="4" strokeLinecap="round" />}
        {outfit === "terno_suspeito" && <path d="M90 111v69M78 118l12 12 12-12" fill="none" stroke="#1e2a45" strokeWidth="5" strokeLinejoin="round" />}
        <circle cx="90" cy="74" r="42" fill="#ffd6ba" stroke="#21172f" strokeWidth="6" />
        <circle cx="72" cy="86" r="6" fill="#f5a88c" fillOpacity=".55" />
        <circle cx="108" cy="86" r="6" fill="#f5a88c" fillOpacity=".55" />
        <path d="M72 70h12m12 0h12" stroke="#3a2740" strokeWidth="5" strokeLinecap="round" />
        <path d="M80 92q10 9 20 0" fill="none" stroke="#3a2740" strokeWidth="4" strokeLinecap="round" />
        {hair === "cabelo_caos" && <><rect x="49" y="23" width="82" height="23" fill="#633b2b" stroke="#21172f" strokeWidth="6" /><rect x="53" y="39" width="18" height="24" fill="#633b2b" stroke="#21172f" strokeWidth="5" /><rect x="109" y="39" width="18" height="24" fill="#633b2b" stroke="#21172f" strokeWidth="5" /><path d="M62 30l6-8 6 8m28 0l6-8 6 8" fill="none" stroke="#4a2c20" strokeWidth="4" strokeLinejoin="round" /></>}
        {hair === "oculos_pixel" && <><rect x="58" y="62" width="29" height="18" rx="3" fill="#1b1430" fillOpacity=".85" stroke="#5fe8ff" strokeWidth="4" /><rect x="94" y="62" width="29" height="18" rx="3" fill="#1b1430" fillOpacity=".85" stroke="#5fe8ff" strokeWidth="4" /><path d="M87 70h7" stroke="#5fe8ff" strokeWidth="4" /><path d="M64 71h17m16 0h17" stroke="#8df2ff" strokeWidth="3" /></>}
        {accessory === "coroa_papel" && <path d="M55 34l12-25 23 22L113 9l12 25v15H55z" fill="#ffe082" stroke="#754e24" strokeWidth="5" strokeLinejoin="round" />}
        {accessory === "corrente_brilho" && <><ellipse cx="90" cy="132" rx="27" ry="10" fill="none" stroke="#ffd34f" strokeWidth="5" /><circle cx="90" cy="142" r="6" fill="#ffd34f" stroke="#7b4d1b" strokeWidth="3" /></>}
      </svg>
    </div>
    {label && <span>{label}</span>}
  </div>;
}
