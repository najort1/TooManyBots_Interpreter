"use client";

import React from "react";

export type Nozzle = "direct" | "mist" | "foam";
export type Camera = "iso" | "first" | "drone";

export interface FirefighterHUDProps {
  water: number;
  pressure: number;
  hydrant: boolean;
  nozzle: Nozzle;
  thermal: boolean;
  camera: Camera;
  victims: number;
  fires: number;
  temperature: number;
  time: number;
  score: number;
  saved: number;
  lost: number;
  targetName?: string;
  targetClass?: string;
  spraying?: boolean;
  onNozzle: (nozzle: Nozzle) => void;
  onThermal: () => void;
  onCamera: (camera: Camera) => void;
  onLadder: () => void;
  onHydrant: () => void;
}

const nozzleInfo: Array<{ id: Nozzle; key: string; label: string; description: string }> = [
  { id: "direct", key: "1", label: "Jato", description: "Fogo comum" },
  { id: "mist", key: "2", label: "Neblina", description: "Resfria e limpa fumaça" },
  { id: "foam", key: "3", label: "Espuma", description: "Produtos químicos" },
];

export function FirefighterHUD(props: FirefighterHUDProps) {
  const mission = props.victims > 0
    ? `Resgate ${props.victims} pessoa${props.victims > 1 ? "s" : ""}: mire no prédio e acione a escada.`
    : props.fires > 0
      ? "Combata os focos: escolha o agente certo e segure o botão APAGAR."
      : "Área segura. Mantenha o quarteirão sob controle.";

  return (
    <section className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3 text-white sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="max-w-[72%] rounded-xl border border-white/20 bg-slate-950/85 px-3 py-2.5 shadow-xl backdrop-blur-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Central 193 · missão ativa</p>
          <p className="mt-1 text-sm font-semibold leading-snug sm:text-base">{mission}</p>
          {props.targetName ? <p className="mt-1 text-xs text-slate-300">Alvo: <b className="text-white">{props.targetName}</b>{props.targetClass ? ` · ${props.targetClass}` : ""}</p> : null}
        </div>
        <div className="rounded-xl border border-white/20 bg-slate-950/85 px-3 py-2 text-right shadow-xl backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-wider text-slate-400">Tempo</p>
          <p className="font-mono text-xl font-bold text-white">{Math.max(0, Math.ceil(props.time))}s</p>
          <p className="text-xs text-amber-300">{props.score} pts</p>
        </div>
      </div>

      <div className="mx-auto mb-2 grid w-full max-w-xl grid-cols-3 gap-2 sm:gap-3">
        <Status label="ÁGUA" value={`${Math.round(props.water)}%`} tone={props.water < 20 ? "red" : "blue"} detail={props.hydrant ? "Hidrante conectado" : "Tanque do caminhão"} />
        <Status label="FOCOS" value={String(props.fires)} tone={props.fires > 0 ? "red" : "green"} detail={`${Math.round(props.temperature)}°C máx.`} />
        <Status label="RESGATE" value={`${props.saved}/${props.saved + props.victims + props.lost}`} tone={props.victims > 0 ? "amber" : "green"} detail={props.victims ? `${props.victims} aguardando` : "Todos seguros"} />
      </div>

      <div className="pointer-events-auto mx-auto w-full max-w-2xl rounded-2xl border border-white/15 bg-slate-950/90 p-2.5 shadow-2xl backdrop-blur-md sm:p-3">
        <div className="grid grid-cols-3 gap-2">
          {nozzleInfo.map((item) => {
            const active = props.nozzle === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => props.onNozzle(item.id)}
                className={`min-h-14 rounded-xl border px-2 py-2 text-left transition ${active ? "border-sky-300 bg-sky-500/30 ring-1 ring-sky-300" : "border-white/15 bg-white/5 hover:bg-white/10"}`}
              >
                <span className="block text-xs font-bold">{item.label} <span className="text-slate-400">[{item.key}]</span></span>
                <span className="mt-0.5 block text-[10px] leading-tight text-slate-300">{item.description}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button type="button" onClick={props.onHydrant} className={`min-h-11 rounded-lg border px-2 text-xs font-bold ${props.hydrant ? "border-emerald-300 bg-emerald-500/20 text-emerald-100" : "border-white/15 bg-white/5"}`}>{props.hydrant ? "✓ HIDRANTE" : "CONECTAR ÁGUA"}</button>
          <button type="button" onClick={props.onLadder} className="min-h-11 rounded-lg border border-amber-300/70 bg-amber-400/15 px-2 text-xs font-bold text-amber-100">ESCADA · RESGATAR</button>
          <button type="button" onClick={props.onThermal} className={`min-h-11 rounded-lg border px-2 text-xs font-bold ${props.thermal ? "border-orange-300 bg-orange-500/25 text-orange-100" : "border-white/15 bg-white/5"}`}>VISÃO TÉRMICA</button>
          <button type="button" onClick={() => props.onCamera(props.camera === "iso" ? "first" : props.camera === "first" ? "drone" : "iso")} className="min-h-11 rounded-lg border border-white/15 bg-white/5 px-2 text-xs font-bold">CÂMERA · {props.camera === "iso" ? "TÁTICA" : props.camera === "first" ? "MANGUEIRA" : "DRONE"}</button>
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-300"><b className="text-white">Como agir:</b> toque em um agente acima, mire no prédio e <b className="text-sky-200">segure APAGAR</b>. Água para fogo comum, espuma para produtos químicos.</p>
      </div>
    </section>
  );
}

function Status({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "blue" | "red" | "amber" | "green" }) {
  const colors = { blue: "text-sky-200", red: "text-red-300", amber: "text-amber-200", green: "text-emerald-200" };
  return <div className="rounded-xl border border-white/15 bg-slate-950/85 px-3 py-2 shadow-lg backdrop-blur-sm"><p className="text-[10px] font-bold tracking-wider text-slate-400">{label}</p><p className={`mt-0.5 text-xl font-bold ${colors[tone]}`}>{value}</p><p className="text-[10px] text-slate-300">{detail}</p></div>;
}

export default FirefighterHUD;
