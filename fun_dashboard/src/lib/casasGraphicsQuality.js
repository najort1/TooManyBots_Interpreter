export const CASAS_GRAPHICS_STORAGE_KEY = "casas-graphics-quality";

export const CASAS_GRAPHICS_QUALITIES = Object.freeze(["performance", "balanced", "high"]);

export const CASAS_GRAPHICS_PRESETS = Object.freeze({
  performance: Object.freeze({
    id: "performance",
    label: "Desempenho",
    maxPixelRatio: 1,
    shadowMapSize: 512,
    bloom: true,
    postProcessingScale: 0.5,
  }),
  balanced: Object.freeze({
    id: "balanced",
    label: "Balanceado",
    maxPixelRatio: 1.25,
    shadowMapSize: 1024,
    bloom: true,
    postProcessingScale: 0.75,
  }),
  high: Object.freeze({
    id: "high",
    label: "Alto",
    maxPixelRatio: 1.65,
    shadowMapSize: 2048,
    bloom: true,
    postProcessingScale: 1,
  }),
});

export function normalizeCasasGraphicsQuality(value) {
  return CASAS_GRAPHICS_QUALITIES.includes(value) ? value : "balanced";
}

export function resolveCasasGraphicsPreset(value, devicePixelRatio = 1) {
  const quality = normalizeCasasGraphicsQuality(value);
  const preset = CASAS_GRAPHICS_PRESETS[quality];
  return {
    ...preset,
    pixelRatio: Math.min(Math.max(Number(devicePixelRatio) || 1, 0.5), preset.maxPixelRatio),
  };
}
