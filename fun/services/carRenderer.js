import sharp from 'sharp';
import {
  PAINT_COLORS,
  SECONDARY_COLORS,
  HEADLIGHT_TINTS,
  WHEELS,
  SPOILERS,
  SUSPENSIONS,
  NEON_UNDERGLOW,
  DECALS,
  WINDOW_TINTS,
  calculateCarPerformance,
} from '../../shared/car/domain.js';

function colorHex(idOrHex, list, fallback) {
  if (!idOrHex) return fallback;
  const match = list.find(
    (item) => item.id === idOrHex || (item.hex && item.hex.toLowerCase() === String(idOrHex).toLowerCase())
  );
  if (match?.hex) return match.hex;
  if (/^#[0-9a-fA-F]{6}$/.test(idOrHex)) return idOrHex;
  return fallback;
}

function escapeXml(unsafe = '') {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Renderiza um SVG estilizado 3D/isométrico ultra-detalhado do carro customizado AAA.
 * @param {object} carState
 * @param {object} [options]
 * @returns {string} SVG string
 */
export function buildCarSvg(carState = {}, options = {}) {
  const primaryColor = colorHex(carState.color, PAINT_COLORS, '#e63946');
  const secondaryColor = colorHex(carState.secondaryColor, SECONDARY_COLORS, '#1d3557');
  const wheelType = carState.wheels || 'sport';
  const spoilerType = carState.spoiler || 'none';
  const suspensionType = carState.suspension || 'normal';
  const neonType = carState.neon || 'none';
  const decalType = carState.decal || 'none';
  const tintType = carState.windowTint || 'light';
  const bodykitType = carState.bodykit || 'stock';
  const headlightType = carState.headlight || 'xenon';
  const plate = (carState.plateText || 'TMB-2026').toUpperCase().slice(0, 8);
  const ownerLabel = options.ownerName || options.userJid || 'Piloto';

  const perf = calculateCarPerformance(carState);

  // Faróis tint
  const hlMatch = HEADLIGHT_TINTS.find((h) => h.id === headlightType);
  const hlHex = hlMatch?.hex || '#ffffff';
  const hlEmissive = hlMatch?.emissiveHex || '#e8f4ff';

  // Suspensão: ajusta offset Y da carroceria
  const susMatch = SUSPENSIONS.find((s) => s.id === suspensionType);
  const susHeightOffset = (susMatch?.heightOffset || 0) * 120; // pixels

  // Neon
  const neonMatch = NEON_UNDERGLOW.find((n) => n.id === neonType);
  const hasNeon = Boolean(neonMatch?.hex);
  const neonHex = neonMatch?.hex || '#00d4ff';

  // Window Tint
  const tintMatch = WINDOW_TINTS.find((t) => t.id === tintType);
  const windowOpacity = tintMatch?.opacity ?? 0.45;

  // Dimensões do SVG
  const width = 1000;
  const height = 620;

  // Coordenadas base do carro (isométrica estilizada lateral-perspectiva)
  const baseY = 360 + susHeightOffset;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <!-- Background Gradients -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0e0a1a"/>
      <stop offset="50%" stop-color="#181328"/>
      <stop offset="100%" stop-color="#080610"/>
    </linearGradient>

    <!-- Grid Platform Gradient -->
    <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2a223f" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#120e1e" stop-opacity="0.95"/>
    </linearGradient>

    <!-- Paint Shading Gradients -->
    <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${primaryColor}"/>
      <stop offset="35%" stop-color="${primaryColor}"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
    </linearGradient>

    <linearGradient id="bodyHighlight" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.4"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.4"/>
    </linearGradient>

    <!-- Metallic Carbon -->
    <linearGradient id="carbonGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#242428"/>
      <stop offset="50%" stop-color="#121214"/>
      <stop offset="100%" stop-color="#2a2a30"/>
    </linearGradient>

    <!-- Chrome Rim Gradient -->
    <linearGradient id="chromeGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="25%" stop-color="#999999"/>
      <stop offset="50%" stop-color="#eeeeee"/>
      <stop offset="75%" stop-color="#555555"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>

    <!-- Neon Glow Filter -->
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="14" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Drop Shadow Filter -->
    <filter id="shadowFilter" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <!-- Dark Cyberpunk Showroom Background -->
  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>

  <!-- Showroom Light Beams -->
  <polygon points="150,0 280,0 350,420 180,420" fill="#ffffff" opacity="0.03"/>
  <polygon points="720,0 850,0 920,420 750,420" fill="#ffffff" opacity="0.03"/>

  <!-- Grid Stage Floor -->
  <ellipse cx="500" cy="460" rx="460" ry="110" fill="url(#floorGrad)" stroke="#382e54" stroke-width="2"/>
  <ellipse cx="500" cy="460" rx="400" ry="92" fill="none" stroke="#4c3d73" stroke-width="1.5" stroke-dasharray="8 8"/>
  <ellipse cx="500" cy="460" rx="330" ry="74" fill="none" stroke="#634f96" stroke-width="1" stroke-dasharray="4 6"/>

  <!-- Neon Underglow Glow (if enabled) -->
  ${
    hasNeon
      ? `<ellipse cx="500" cy="${baseY + 58}" rx="320" ry="46" fill="${neonHex}" opacity="0.85" filter="url(#neonGlow)"/>
         <ellipse cx="500" cy="${baseY + 58}" rx="280" ry="34" fill="#ffffff" opacity="0.4" filter="url(#neonGlow)"/>`
      : ''
  }

  <!-- Under-car Ground Shadow -->
  <ellipse cx="500" cy="${baseY + 55}" rx="335" ry="38" fill="#000000" opacity="0.75" filter="url(#shadowFilter)"/>

  <!-- ================= CAR BODY GROUP ================= -->
  <g id="carChassis" transform="translate(0, 0)">

    <!-- Aerodynamic Rear Diffuser & Exhaust Tips -->
    <path d="M 210 ${baseY + 22} L 240 ${baseY + 38} L 270 ${baseY + 38} L 285 ${baseY + 24} Z" fill="#151518" stroke="#333" stroke-width="2"/>
    <ellipse cx="230" cy="${baseY + 32}" rx="7" ry="5" fill="#0a0a0c" stroke="#555" stroke-width="2"/>
    <ellipse cx="230" cy="${baseY + 32}" rx="4" ry="3" fill="#00f0ff" opacity="0.8"/>
    <ellipse cx="255" cy="${baseY + 32}" rx="7" ry="5" fill="#0a0a0c" stroke="#555" stroke-width="2"/>
    <ellipse cx="255" cy="${baseY + 32}" rx="4" ry="3" fill="#00f0ff" opacity="0.8"/>

    <!-- Main Lower Chassis Sill -->
    <path d="M 200 ${baseY + 16} Q 360 ${baseY + 26} 500 ${baseY + 26} T 800 ${baseY + 16} L 785 ${baseY + 32} Q 500 ${baseY + 38} 215 ${baseY + 32} Z" fill="#111114" stroke="#222" stroke-width="1.5"/>

    <!-- Main Body Shell (Sleek Supercar Profile) -->
    <path d="
      M 190 ${baseY - 10}
      C 195 ${baseY - 45}, 210 ${baseY - 70}, 275 ${baseY - 78}
      C 340 ${baseY - 84}, 395 ${baseY - 145}, 460 ${baseY - 165}
      L 630 ${baseY - 165}
      C 690 ${baseY - 145}, 725 ${baseY - 75}, 775 ${baseY - 60}
      L 820 ${baseY - 30}
      C 835 ${baseY - 10}, 835 ${baseY + 10}, 815 ${baseY + 20}
      L 770 ${baseY + 24}
      C 760 ${baseY - 10}, 730 ${baseY - 30}, 690 ${baseY - 30}
      C 645 ${baseY - 30}, 620 ${baseY + 5}, 610 ${baseY + 24}
      L 395 ${baseY + 24}
      C 385 ${baseY - 10}, 355 ${baseY - 30}, 315 ${baseY - 30}
      C 270 ${baseY - 30}, 245 ${baseY + 5}, 235 ${baseY + 24}
      L 190 ${baseY + 18}
      C 180 ${baseY + 8}, 180 ${baseY - 2}, 190 ${baseY - 10}
      Z
    " fill="url(#bodyGrad)" stroke="${secondaryColor}" stroke-width="3"/>

    <!-- Body Shading & Metallic Highlights -->
    <path d="
      M 195 ${baseY - 10}
      C 220 ${baseY - 60}, 320 ${baseY - 75}, 455 ${baseY - 160}
      L 625 ${baseY - 160}
      C 680 ${baseY - 140}, 720 ${baseY - 70}, 770 ${baseY - 55}
      L 815 ${baseY - 28}
      L 760 ${baseY - 42}
      C 715 ${baseY - 55}, 670 ${baseY - 130}, 620 ${baseY - 150}
      L 465 ${baseY - 150}
      C 410 ${baseY - 130}, 335 ${baseY - 70}, 265 ${baseY - 62}
      Z
    " fill="url(#bodyHighlight)"/>

    <!-- Widebody Bolt-On Fenders (if widebody) -->
    ${
      bodykitType === 'widebody' || bodykitType === 'time_attack'
        ? `<!-- Widebody Fender Flares -->
           <path d="M 260 ${baseY - 25} C 260 ${baseY - 45} 370 ${baseY - 45} 370 ${baseY - 25} L 360 ${baseY - 18} C 350 ${baseY - 35} 280 ${baseY - 35} 270 ${baseY - 18} Z" fill="#111" stroke="${primaryColor}" stroke-width="2"/>
           <path d="M 635 ${baseY - 25} C 635 ${baseY - 45} 745 ${baseY - 45} 745 ${baseY - 25} L 735 ${baseY - 18} C 725 ${baseY - 35} 655 ${baseY - 35} 645 ${baseY - 18} Z" fill="#111" stroke="${primaryColor}" stroke-width="2"/>`
        : ''
    }

    <!-- Time Attack Carbon Canards & Splitter (if time_attack) -->
    ${
      bodykitType === 'time_attack'
        ? `<!-- Carbon Fiber Front Canards -->
           <polygon points="790,${baseY + 8} 835,${baseY - 2} 830,${baseY - 8} 788,${baseY}" fill="url(#carbonGrad)" stroke="#00f0ff" stroke-width="1.5"/>
           <polygon points="795,${baseY + 22} 845,${baseY + 12} 840,${baseY + 6} 792,${baseY + 15}" fill="url(#carbonGrad)" stroke="#00f0ff" stroke-width="1.5"/>`
        : ''
    }

    <!-- Aerodynamic Side Scoop / Air Intake -->
    <path d="M 470 ${baseY - 18} L 545 ${baseY - 24} L 555 ${baseY + 4} L 485 ${baseY + 12} Z" fill="#0d0d10" stroke="#333" stroke-width="2"/>
    <path d="M 480 ${baseY - 14} L 535 ${baseY - 18} L 545 ${baseY + 2} L 492 ${baseY + 8} Z" fill="${secondaryColor}" opacity="0.7"/>

    <!-- Side Door Seam & Character Lines -->
    <path d="M 390 ${baseY - 65} L 460 ${baseY + 20}" fill="none" stroke="#000000" stroke-width="2" opacity="0.6"/>
    <path d="M 605 ${baseY - 70} L 580 ${baseY + 20}" fill="none" stroke="#000000" stroke-width="2" opacity="0.6"/>

    <!-- ================= DECALS ================= -->
    ${
      decalType === 'stripes'
        ? `<path d="M 425 ${baseY - 164} L 635 ${baseY - 164} L 785 ${baseY - 56} L 820 ${baseY - 28} L 808 ${baseY - 28} L 775 ${baseY - 56} L 630 ${baseY - 158} L 430 ${baseY - 158} Z" fill="${secondaryColor}" opacity="0.95"/>`
        : ''
    }
    ${
      decalType === 'flames'
        ? `<path d="M 380 ${baseY - 15} Q 460 ${baseY - 45} 510 ${baseY - 15} Q 470 ${baseY - 25} 440 ${baseY - 12} Q 520 ${baseY - 38} 560 ${baseY - 10} L 520 ${baseY + 6} Q 440 ${baseY} 380 ${baseY - 15} Z" fill="#ff4d00" opacity="0.9"/>
           <path d="M 390 ${baseY - 12} Q 450 ${baseY - 36} 490 ${baseY - 14} Q 460 ${baseY - 20} 435 ${baseY - 10} Q 490 ${baseY - 30} 530 ${baseY - 8} L 500 ${baseY + 4} Q 435 ${baseY - 1} 390 ${baseY - 12} Z" fill="#ffea00" opacity="0.95"/>`
        : ''
    }
    ${
      decalType === 'dragon'
        ? `<path d="M 410 ${baseY - 20} Q 480 ${baseY - 65} 550 ${baseY - 30} Q 520 ${baseY - 40} 480 ${baseY - 25} Q 560 ${baseY - 50} 610 ${baseY - 18} L 590 ${baseY - 8} Q 540 ${baseY - 22} 470 ${baseY - 10} Z" fill="#00f0ff" opacity="0.85"/>
           <circle cx="595" cy="${baseY - 16}" r="3" fill="#ffffff"/>`
        : ''
    }
    ${
      decalType === 'carbon'
        ? `<path d="M 640 ${baseY - 140} L 725 ${baseY - 72} L 815 ${baseY - 28} L 760 ${baseY - 45} L 685 ${baseY - 125} Z" fill="url(#carbonGrad)" stroke="#333" stroke-width="1.5" opacity="0.92"/>`
        : ''
    }

    <!-- ================= CABIN & WINDOWS ================= -->
    <path d="
      M 370 ${baseY - 75}
      L 455 ${baseY - 155}
      L 620 ${baseY - 155}
      L 685 ${baseY - 75}
      Z
    " fill="#09090c" stroke="#25252c" stroke-width="3"/>

    <!-- Tinted Glass Window -->
    <path d="
      M 382 ${baseY - 76}
      L 460 ${baseY - 148}
      L 612 ${baseY - 148}
      L 672 ${baseY - 76}
      Z
    " fill="#0a121c" opacity="${windowOpacity}"/>

    <!-- Window Pillar Splitter (B-Pillar) -->
    <line x1="515" y1="${baseY - 150}" x2="510" y2="${baseY - 76}" stroke="#1e1e24" stroke-width="7"/>

    <!-- Side View Mirror -->
    <path d="M 622 ${baseY - 88} L 642 ${baseY - 96} L 646 ${baseY - 82} L 624 ${baseY - 80} Z" fill="${primaryColor}" stroke="#151518" stroke-width="1.5"/>

    <!-- ================= LIGHTS ================= -->
    <!-- Headlights com tint customizado -->
    <polygon points="785,${baseY - 48} 822,${baseY - 26} 808,${baseY - 16} 776,${baseY - 38}" fill="${hlHex}" stroke="${hlEmissive}" stroke-width="1.5" filter="url(#neonGlow)"/>
    <polygon points="790,${baseY - 44} 818,${baseY - 26} 810,${baseY - 20} 784,${baseY - 38}" fill="#ffffff"/>

    <!-- Taillights -->
    <path d="M 188 ${baseY - 12} Q 185 ${baseY + 5} 196 ${baseY + 12} L 210 ${baseY + 8} L 202 ${baseY - 14} Z" fill="#ff1744" stroke="#ff5252" stroke-width="2" filter="url(#neonGlow)"/>

    <!-- License Plate Frame & Custom Text -->
    <rect x="184" y="${baseY + 15}" width="38" height="18" rx="2" fill="#ffffff" stroke="#111" stroke-width="1.5"/>
    <rect x="186" y="${baseY + 17}" width="34" height="4" fill="#003399"/>
    <text x="203" y="${baseY + 30}" font-family="monospace, sans-serif" font-size="8" font-weight="900" text-anchor="middle" fill="#111111">${escapeXml(plate)}</text>

    <!-- Front Bumper Lip / Splitter -->
    <path d="M 760 ${baseY + 22} L 825 ${baseY + 14} L 836 ${baseY + 26} L 768 ${baseY + 30} Z" fill="#15151a" stroke="#333" stroke-width="1.5"/>

    <!-- ================= SPOILER ================= -->
    ${
      spoilerType === 'ducktail'
        ? `<path d="M 188 ${baseY - 32} Q 198 ${baseY - 60} 228 ${baseY - 68} L 234 ${baseY - 62} Q 206 ${baseY - 52} 198 ${baseY - 26} Z" fill="${secondaryColor}" stroke="#111" stroke-width="2"/>`
        : ''
    }
    ${
      spoilerType === 'gt_wing'
        ? `<!-- GT Wing Carbon Spoiler -->
           <line x1="210" y1="${baseY - 38}" x2="202" y2="${baseY - 105}" stroke="#111" stroke-width="4"/>
           <line x1="245" y1="${baseY - 50}" x2="236" y2="${baseY - 105}" stroke="#111" stroke-width="4"/>
           <path d="M 175 ${baseY - 105} Q 230 ${baseY - 114} 275 ${baseY - 104} L 278 ${baseY - 96} Q 230 ${baseY - 104} 178 ${baseY - 97} Z" fill="url(#carbonGrad)" stroke="${secondaryColor}" stroke-width="2.5"/>
           <polygon points="172,${baseY - 120} 182,${baseY - 120} 178,${baseY - 90} 168,${baseY - 90}" fill="${secondaryColor}"/>
           <polygon points="274,${baseY - 118} 284,${baseY - 118} 280,${baseY - 88} 270,${baseY - 88}" fill="${secondaryColor}"/>`
        : ''
    }
    ${
      spoilerType === 'drag_wing'
        ? `<!-- High-mount Drag Wing -->
           <polygon points="170,${baseY - 135} 280,${baseY - 145} 275,${baseY - 130} 175,${baseY - 122}" fill="url(#carbonGrad)" stroke="#ff0055" stroke-width="2.5"/>
           <line x1="185" y1="${baseY - 30}" x2="182" y2="${baseY - 130}" stroke="#222" stroke-width="5"/>
           <line x1="230" y1="${baseY - 45}" x2="225" y2="${baseY - 135}" stroke="#222" stroke-width="5"/>`
        : ''
    }

    <!-- ================= WHEELS ================= -->
    <g id="rearWheel" transform="translate(315, ${baseY + 22})">
      <circle cx="0" cy="0" r="54" fill="#141416" stroke="#0a0a0c" stroke-width="5"/>
      <circle cx="0" cy="0" r="47" fill="none" stroke="#222228" stroke-width="2" stroke-dasharray="6 4"/>
      <circle cx="0" cy="0" r="38" fill="#1a1a20" stroke="url(#chromeGrad)" stroke-width="3"/>
      <circle cx="0" cy="0" r="28" fill="#55555c" stroke="#333" stroke-width="1"/>
      <path d="M 12 -22 A 26 26 0 0 1 24 -6 L 16 -4 A 18 18 0 0 0 8 -16 Z" fill="#e63946"/>
      ${renderWheelRims(wheelType)}
      <circle cx="0" cy="0" r="7" fill="#000000" stroke="${primaryColor}" stroke-width="2"/>
    </g>

    <g id="frontWheel" transform="translate(690, ${baseY + 22})">
      <circle cx="0" cy="0" r="54" fill="#141416" stroke="#0a0a0c" stroke-width="5"/>
      <circle cx="0" cy="0" r="47" fill="none" stroke="#222228" stroke-width="2" stroke-dasharray="6 4"/>
      <circle cx="0" cy="0" r="38" fill="#1a1a20" stroke="url(#chromeGrad)" stroke-width="3"/>
      <circle cx="0" cy="0" r="28" fill="#55555c" stroke="#333" stroke-width="1"/>
      <path d="M 12 -22 A 26 26 0 0 1 24 -6 L 16 -4 A 18 18 0 0 0 8 -16 Z" fill="#e63946"/>
      ${renderWheelRims(wheelType)}
      <circle cx="0" cy="0" r="7" fill="#000000" stroke="${primaryColor}" stroke-width="2"/>
    </g>

  </g>
  <!-- ================= END CAR BODY ================= -->

  <!-- Card HUD Header & Specs Banner AAA -->
  <g id="hudBanner" transform="translate(35, 30)">
    <rect width="930" height="82" rx="16" fill="#100c22" fill-opacity="0.88" stroke="#3d2c60" stroke-width="1.8"/>

    <!-- Badge PR Score -->
    <rect x="20" y="18" width="80" height="46" rx="10" fill="url(#carbonGrad)" stroke="#ffd700" stroke-width="1.5"/>
    <text x="60" y="36" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="900" fill="#ffd700" text-anchor="middle" letter-spacing="1">PR SCORE</text>
    <text x="60" y="56" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="900" fill="#ffffff" text-anchor="middle">${perf.prScore}</text>

    <!-- Título do Piloto e Placa -->
    <text x="115" y="38" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="900" fill="#ffffff" letter-spacing="0.5">
      GARAGEM VIP <tspan fill="${primaryColor}">•</tspan> CARRO DE FUGA GT
    </text>
    <text x="115" y="58" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="600" fill="#a49bc2">
      Piloto: <tspan fill="#ffffff" font-weight="700">${escapeXml(ownerLabel)}</tspan> | Placa: <tspan fill="${primaryColor}" font-weight="700">${escapeXml(plate)}</tspan>
    </text>

    <!-- Telemetria Pills -->
    <g transform="translate(565, 20)">
      <rect x="0" y="0" width="80" height="42" rx="8" fill="#1b1433" stroke="#48366e" stroke-width="1"/>
      <text x="40" y="16" font-family="sans-serif" font-size="9" font-weight="700" fill="#a49bc2" text-anchor="middle">MOTOR</text>
      <text x="40" y="32" font-family="sans-serif" font-size="12" font-weight="900" fill="#ffffff" text-anchor="middle">${perf.horsepower} cv</text>

      <rect x="90" y="0" width="80" height="42" rx="8" fill="#1b1433" stroke="#48366e" stroke-width="1"/>
      <text x="130" y="16" font-family="sans-serif" font-size="9" font-weight="700" fill="#a49bc2" text-anchor="middle">0 - 100</text>
      <text x="130" y="32" font-family="sans-serif" font-size="12" font-weight="900" fill="#ffd166" text-anchor="middle">${perf.zeroToHundredSec}s</text>

      <rect x="180" y="0" width="80" height="42" rx="8" fill="#1b1433" stroke="#48366e" stroke-width="1"/>
      <text x="220" y="16" font-family="sans-serif" font-size="9" font-weight="700" fill="#a49bc2" text-anchor="middle">VEL. MÁX</text>
      <text x="220" y="32" font-family="sans-serif" font-size="12" font-weight="900" fill="#00f0ff" text-anchor="middle">${perf.topSpeedKmh}</text>

      <rect x="270" y="0" width="80" height="42" rx="8" fill="#1b1433" stroke="#48366e" stroke-width="1"/>
      <text x="310" y="16" font-family="sans-serif" font-size="9" font-weight="700" fill="#a49bc2" text-anchor="middle">ESTILO</text>
      <text x="310" y="32" font-family="sans-serif" font-size="12" font-weight="900" fill="#ff007f" text-anchor="middle">${perf.styleScore}/100</text>
    </g>
  </g>

  <!-- Watermark Footer -->
  <text x="960" y="595" font-family="sans-serif" font-size="11" font-weight="600" fill="#584878" text-anchor="end">
    TooManyBots Fun • Garagem 3D AAA &amp; Tuning Shop
  </text>
</svg>
  `.trim();
}

function renderWheelRims(type) {
  switch (type) {
    case 'classic':
      return `
        <g stroke="url(#chromeGrad)" stroke-width="1.8">
          ${[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
            .map((angle) => `<line x1="0" y1="0" x2="${Math.cos((angle * Math.PI) / 180) * 36}" y2="${Math.sin((angle * Math.PI) / 180) * 36}"/>`)
            .join('\n')}
        </g>
      `;
    case 'deep_dish':
      return `
        <circle cx="0" cy="0" r="34" fill="#000" stroke="#ffd700" stroke-width="5"/>
        <g stroke="#ffd700" stroke-width="3">
          ${[0, 72, 144, 216, 288]
            .map((angle) => `<line x1="0" y1="0" x2="${Math.cos((angle * Math.PI) / 180) * 32}" y2="${Math.sin((angle * Math.PI) / 180) * 32}"/>`)
            .join('\n')}
        </g>
      `;
    case 'offroad':
      return `
        <circle cx="0" cy="0" r="36" fill="#1b1b1f" stroke="#e63946" stroke-width="3.5"/>
        <g stroke="#777" stroke-width="4">
          ${[0, 60, 120, 180, 240, 300]
            .map((angle) => `<line x1="0" y1="0" x2="${Math.cos((angle * Math.PI) / 180) * 32}" y2="${Math.sin((angle * Math.PI) / 180) * 32}"/>`)
            .join('\n')}
        </g>
      `;
    case 'turbofan':
      return `
        <circle cx="0" cy="0" r="36" fill="#f8f9fa" stroke="#111" stroke-width="2"/>
        <circle cx="0" cy="0" r="28" fill="none" stroke="#e63946" stroke-width="3" stroke-dasharray="12 6"/>
        <circle cx="0" cy="0" r="16" fill="#111"/>
      `;
    case 'chrome':
      return `
        <g stroke="url(#chromeGrad)" stroke-width="4.5">
          ${[0, 60, 120, 180, 240, 300]
            .map((angle) => `<line x1="0" y1="0" x2="${Math.cos((angle * Math.PI) / 180) * 36}" y2="${Math.sin((angle * Math.PI) / 180) * 36}"/>`)
            .join('\n')}
        </g>
      `;
    case 'sport':
    default:
      return `
        <g stroke="url(#chromeGrad)" stroke-width="3.8">
          ${[0, 72, 144, 216, 288]
            .map((angle) => `<line x1="0" y1="0" x2="${Math.cos((angle * Math.PI) / 180) * 36}" y2="${Math.sin((angle * Math.PI) / 180) * 36}"/>`)
            .join('\n')}
        </g>
      `;
  }
}

/**
 * Converte a cena do carro para buffer PNG de alta qualidade usando sharp.
 * @param {object} carState
 * @param {object} [options]
 * @returns {Promise<Buffer>}
 */
export async function renderCarPng(carState = {}, options = {}) {
  const svg = buildCarSvg(carState, options);
  const sharpInstance = options.sharp || sharp;
  return sharpInstance(Buffer.from(svg))
    .png({ quality: 95, compressionLevel: 8 })
    .toBuffer();
}
