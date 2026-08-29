"use client";

import { Gauge } from "lucide-react";
import { useCasasGraphics, type CasasGraphicsQuality } from "./CasasGraphicsProvider";

export default function GraphicsQualityControl() {
  const { quality, setQuality } = useCasasGraphics();
  return <label className="casas-quality-control" title="Qualidade gráfica">
    <Gauge size={15} aria-hidden="true" />
    <span className="sr-only">Qualidade gráfica</span>
    <select value={quality} onChange={(event) => setQuality(event.target.value as CasasGraphicsQuality)} aria-label="Qualidade gráfica">
      <option value="performance">Desempenho</option>
      <option value="balanced">Balanceado</option>
      <option value="high">Alto</option>
    </select>
  </label>;
}
