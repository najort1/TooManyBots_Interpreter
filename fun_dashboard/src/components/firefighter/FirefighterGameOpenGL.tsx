"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Incident = {
  id: number;
  label: string;
  district: string;
  floors: number;
  fire: number;
  victim: boolean;
  rescued: boolean;
  color: string;
};

type Props = {
  config?: { durationMs?: number; targetScore?: number; maxLostHouses?: number };
  onDone: (score: number, metrics: Record<string, number>) => void;
};

const INITIAL_INCIDENTS: Incident[] = [
  { id: 1, label: "Casa da praça", district: "Vila Central", floors: 2, fire: 100, victim: true, rescued: false, color: "bg-amber-200" },
  { id: 2, label: "Loja de tintas", district: "Rua do Mercado", floors: 1, fire: 78, victim: false, rescued: false, color: "bg-rose-200" },
  { id: 3, label: "Edifício Sol", district: "Avenida Norte", floors: 4, fire: 62, victim: true, rescued: false, color: "bg-sky-200" },
];

export function FirefighterGameOpenGL({ config, onDone }: Props) {
  const duration = Math.max(45, Math.round((config?.durationMs ?? 90_000) / 1000));
  const goal = Math.max(3, Math.round((config?.targetScore ?? 20) / 5));
  const [incidents, setIncidents] = useState(INITIAL_INCIDENTS);
  const [selectedId, setSelectedId] = useState(1);
  const [seconds, setSeconds] = useState(duration);
  const [water, setWater] = useState(100);
  const [rescued, setRescued] = useState(0);
  const [isSpraying, setIsSpraying] = useState(false);
  const [tip, setTip] = useState("Toque no prédio em chamas. Depois segure APAGAR INCÊNDIO.");
  const finished = useRef(false);

  const selected = incidents.find((incident) => incident.id === selectedId) ?? incidents[0];
  const active = incidents.filter((incident) => incident.fire > 0);
  const completed = incidents.filter((incident) => incident.fire <= 0).length;

  const finish = useCallback((finalIncidents: Incident[], finalRescued: number) => {
    if (finished.current) return;
    finished.current = true;
    const firesOut = finalIncidents.filter((incident) => incident.fire <= 0).length;
    const score = firesOut * 5 + finalRescued * 5;
    onDone(score, {
      firesExtinguished: firesOut,
      victimsSaved: finalRescued,
      lostHouses: finalIncidents.filter((incident) => incident.fire > 0).length,
      waterUsed: 100 - water,
      targetReached: firesOut >= goal ? 1 : 0,
    });
  }, [goal, onDone, water]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          finish(incidents, rescued);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [finish, incidents, rescued]);

  useEffect(() => {
    if (!isSpraying || !selected || selected.fire <= 0) return;
    const hose = window.setInterval(() => {
      setWater((current) => Math.max(0, current - 1.4));
      setIncidents((current) => {
        const next = current.map((incident) => incident.id === selected.id ? { ...incident, fire: Math.max(0, incident.fire - 4) } : incident);
        const updated = next.find((incident) => incident.id === selected.id);
        if (updated && updated.fire <= 0) {
          setIsSpraying(false);
          setTip(updated.victim && !updated.rescued ? "Incêndio controlado. Agora faça o resgate." : "Incêndio apagado. Escolha o próximo chamado.");
        }
        return next;
      });
    }, 120);
    return () => window.clearInterval(hose);
  }, [isSpraying, selected]);

  useEffect(() => {
    if (completed >= goal && active.length === 0) finish(incidents, rescued);
  }, [active.length, completed, finish, goal, incidents, rescued]);

  const chooseIncident = (incident: Incident) => {
    setSelectedId(incident.id);
    setIsSpraying(false);
    if (incident.fire > 0) setTip("Prédio selecionado. Segure APAGAR INCÊNDIO até a barra zerar.");
    else if (incident.victim && !incident.rescued) setTip("O local está seguro. Toque em RESGATAR PESSOA.");
    else setTip("Chamado resolvido. Escolha outro prédio em emergência.");
  };

  const rescue = () => {
    if (!selected || selected.fire > 0 || !selected.victim || selected.rescued) return;
    setIncidents((current) => current.map((incident) => incident.id === selected.id ? { ...incident, rescued: true } : incident));
    setRescued((value) => value + 1);
    setTip("Pessoa resgatada com segurança. Próximo chamado!");
  };

  const refill = () => {
    setWater(100);
    setTip("Caminhão reabastecido. Volte ao combate.");
  };

  const canSpray = Boolean(selected && selected.fire > 0 && water > 0);
  const rescueAvailable = Boolean(selected && selected.fire <= 0 && selected.victim && !selected.rescued);

  return (
    <main className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-[#f7fbff] text-slate-900 shadow-xl">
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Central de emergência</p><h1 className="mt-0.5 text-xl font-black">Missão: apagar os incêndios</h1></div>
          <div className="rounded-xl bg-slate-900 px-3 py-2 text-center text-white"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Tempo</p><p className="font-mono text-xl font-black">{seconds}s</p></div>
        </div>
        <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm font-medium text-sky-950"><span className="mr-2 text-sky-600">●</span>{tip}</p>
      </header>

      <section className="grid grid-cols-3 gap-2 border-b border-slate-200 bg-white px-5 py-3">
        <Metric label="Prédios" value={`${completed}/${incidents.length}`} hint={`meta: ${goal}`} />
        <Metric label="Resgates" value={String(rescued)} hint="pessoas salvas" />
        <Metric label="Água" value={`${Math.round(water)}%`} hint={water < 20 ? "reabasteça" : "no caminhão"} urgent={water < 20} />
      </section>

      <section className="relative min-h-[330px] overflow-hidden bg-gradient-to-b from-sky-200 via-sky-100 to-emerald-100 px-4 pb-6 pt-14">
        <div className="absolute inset-x-0 bottom-0 h-24 bg-slate-600" />
        <div className="absolute inset-x-0 bottom-20 h-3 bg-slate-300" />
        <div className="absolute left-4 top-4 rounded-full bg-white/85 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">Toque em um chamado</div>
        <div className="relative z-10 grid grid-cols-3 items-end gap-3">
          {incidents.map((incident) => {
            const chosen = incident.id === selectedId;
            return <button key={incident.id} type="button" onClick={() => chooseIncident(incident)} className={`relative flex min-h-48 flex-col justify-end rounded-t-xl border-4 p-2 text-left shadow-lg transition active:scale-95 ${chosen ? "border-sky-600 ring-4 ring-sky-300/70" : "border-white/80"} ${incident.color}`}>
              {incident.fire > 0 ? <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-pulse text-4xl" aria-label="Incêndio">🔥</div> : <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-3xl">{incident.victim && !incident.rescued ? "🧍" : "✓"}</div>}
              <div className="mb-auto grid grid-cols-2 gap-1 pt-3">{Array.from({ length: Math.min(incident.floors * 2, 8) }).map((_, index) => <span key={index} className="h-4 rounded-sm bg-slate-700/70" />)}</div>
              <p className="mt-2 text-xs font-black leading-tight">{incident.label}</p>
              <p className="text-[10px] font-medium text-slate-600">{incident.district}</p>
              {incident.fire > 0 ? <div className="mt-2"><div className="h-2 overflow-hidden rounded-full bg-slate-900/15"><div className="h-full rounded-full bg-red-600" style={{ width: `${incident.fire}%` }} /></div><p className="mt-1 text-[10px] font-bold text-red-800">INCÊNDIO {Math.ceil(incident.fire)}%</p></div> : <p className="mt-2 text-[10px] font-bold text-emerald-800">{incident.victim && !incident.rescued ? "AGUARDA RESGATE" : "SEGURO"}</p>}
            </button>;
          })}
        </div>
        <div className="absolute bottom-3 left-4 text-3xl">🚒</div>
      </section>

      <section className="bg-white p-4">
        {rescueAvailable ? <button type="button" onClick={rescue} className="min-h-16 w-full rounded-2xl bg-amber-400 px-4 text-base font-black text-amber-950 shadow-md transition active:scale-[0.98]">RESGATAR PESSOA</button> : <button type="button" disabled={!canSpray} onPointerDown={() => setIsSpraying(true)} onPointerUp={() => setIsSpraying(false)} onPointerLeave={() => setIsSpraying(false)} onPointerCancel={() => setIsSpraying(false)} className={`min-h-16 w-full rounded-2xl px-4 text-base font-black text-white shadow-md transition active:scale-[0.98] ${canSpray ? "bg-sky-600" : "bg-slate-300"}`}>{canSpray ? (isSpraying ? "💦 APAGANDO..." : "SEGURE PARA APAGAR INCÊNDIO") : water <= 0 ? "SEM ÁGUA" : "ESCOLHA UM PRÉDIO EM CHAMAS"}</button>}
        <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs leading-snug text-slate-600">{rescueAvailable ? "Primeiro apague o fogo. Depois, retire a pessoa do prédio." : "Segure o botão azul. A barra vermelha mostra quanto fogo ainda resta."}</p><button type="button" onClick={refill} className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">Reabastecer</button></div>
      </section>
    </main>
  );
}

function Metric({ label, value, hint, urgent = false }: { label: string; value: string; hint: string; urgent?: boolean }) {
  return <div className="border-r border-slate-100 last:border-0"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p><p className={`mt-0.5 text-lg font-black ${urgent ? "text-red-600" : "text-slate-900"}`}>{value}</p><p className="text-[10px] text-slate-500">{hint}</p></div>;
}

export default FirefighterGameOpenGL;
