"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Armchair, Camera, ChevronRight, CircleHelp, House, LocateFixed, Map, Minus, Music2, Plus, Search, Trees, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NeighborhoodHouse } from "@/lib/types";
import styles from "./StreetControls.module.css";

export type StreetCameraView = "follow" | "plaza" | "village" | "wide";
type Panel = "residents" | "help" | null;
type Props = {
  houses: NeighborhoodHouse[];
  cameraView: StreetCameraView;
  zoom: number;
  hint: string;
  dancing: boolean;
  canSit: boolean;
  seated: boolean;
  disabled: boolean;
  onCamera: (view: StreetCameraView) => void;
  onZoom: (amount: number) => void;
  onReset: () => void;
  onDance: () => void;
  onSit: () => void;
  onVisit: (house: NeighborhoodHouse) => void;
  onPanelChange: (open: boolean) => void;
};

const views = [
  { id: "follow", label: "Seguir", icon: LocateFixed },
  { id: "plaza", label: "Praça", icon: Trees },
  { id: "village", label: "Vila", icon: House },
  { id: "wide", label: "Panorama", icon: Map },
] as const;

const searchKey = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();

export default function StreetControls(props: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const residentsTrigger = useRef<HTMLButtonElement>(null);
  const helpTrigger = useRef<HTMLButtonElement>(null);
  const panelElement = useRef<HTMLElement>(null);
  const { onPanelChange } = props;
  const sortedHouses = useMemo(() => [...props.houses]
    .map((house) => ({ ...house, _key: searchKey(house.nickname) }))
    .sort((a, b) => a.nickname.localeCompare(b.nickname, "pt-BR")), [props.houses]);

  const residents = useMemo(() => {
    const q = searchKey(query);
    if (!q) return sortedHouses;
    return sortedHouses.filter((house) => house._key.includes(q));
  }, [sortedHouses, query]);

  useEffect(() => {
    onPanelChange(panel !== null);
    if (!panel) return;
    const trigger = panel === "residents" ? residentsTrigger.current : helpTrigger.current;
    panelElement.current?.querySelector<HTMLElement>(panel === "residents" ? "input" : "button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPanel(null); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      trigger?.focus();
    };
  }, [onPanelChange, panel]);

  return <>
    <div className={styles.navigation}>
      <div className={styles.camera} role="group" aria-label="Câmera do bairro">
        {views.map(({ id, label, icon: Icon }) => <Button key={id} variant="ghost" className={styles.button} aria-pressed={props.cameraView === id} disabled={props.disabled} onClick={() => props.onCamera(id)}><Icon size={16} /><span>{label}</span></Button>)}
        <span className={styles.divider} />
        <Button variant="ghost" className={styles.iconButton} aria-label="Afastar câmera" disabled={props.disabled || props.zoom <= .68} onClick={() => props.onZoom(-.1)}><Minus size={16} /></Button>
        <Button variant="ghost" className={styles.zoom} aria-label="Restaurar câmera e zoom" title="Voltar ao seu avatar e restaurar zoom" disabled={props.disabled} onClick={props.onReset}>{Math.round(props.zoom * 100)}%</Button>
        <Button variant="ghost" className={styles.iconButton} aria-label="Aproximar câmera" disabled={props.disabled || props.zoom >= 1.5} onClick={() => props.onZoom(.1)}><Plus size={16} /></Button>
      </div>
      <button ref={residentsTrigger} className={styles.residentsTrigger} aria-expanded={panel === "residents"} aria-controls={panel === "residents" ? panelId : undefined} disabled={props.disabled} onClick={() => setPanel(panel === "residents" ? null : "residents")}><Users size={17} /><span>Moradores</span><b>{props.houses.length}</b></button>
    </div>

    {panel && <section ref={panelElement} className={styles.panel} id={panelId} role="dialog" aria-label={panel === "residents" ? "Moradores do bairro" : "Como jogar"} aria-modal="false">
      <header><div><small>{panel === "residents" ? "BAIRRO DO GRUPO" : "À VONTADE NO BECO"}</small><h2>{panel === "residents" ? "Quem você vai visitar?" : "Como jogar"}</h2></div><Button variant="ghost" className={styles.iconButton} aria-label="Fechar painel" onClick={() => setPanel(null)}><X size={18} /></Button></header>
      {panel === "residents" ? <>
        <label className={styles.search}><Search size={17} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar morador…" aria-label="Buscar morador" /></label>
        <p className={styles.count} role="status">{residents.length} {residents.length === 1 ? "casa disponível" : "casas disponíveis"}</p>
        <div className={styles.list}>
          {residents.map((house) => <Button key={house.id} variant="ghost" className={styles.resident} disabled={props.disabled} onClick={() => { setPanel(null); props.onVisit(house); }} aria-label={`Visitar ${house.nickname}`}><span className={styles.houseIcon}><House size={18} /></span><span className={styles.residentName}><b>{house.nickname}</b><small>Visitar casa</small></span><ChevronRight size={17} /></Button>)}
          {!residents.length && <div className={styles.empty}><House size={26} /><b>{props.houses.length ? "Nenhum morador encontrado" : "O bairro está começando"}</b><p>{props.houses.length ? "Tente outro nome ou limpe a busca." : "As casas dos membros do grupo aparecerão aqui."}</p>{query && <Button className={styles.button} variant="ghost" onClick={() => setQuery("")}>Limpar busca</Button>}</div>}
        </div>
      </> : <div className={styles.help}>
        <p>Toque no chão para andar e em uma porta para visitar. Toque num banco para sentar.</p>
        <dl><div><dt>Andar</dt><dd><kbd>W A S D</kbd> ou <kbd>↑ ← ↓ →</kbd></dd></div><div><dt>Sentar / levantar</dt><dd><kbd>E</kbd></dd></div><div><dt>Dançar / parar</dt><dd><kbd>Q</kbd></dd></div><div><dt>Zoom</dt><dd>Roda do mouse ou <kbd>− +</kbd></dd></div><div><dt>Fechar painel</dt><dd><kbd>Esc</kbd></dd></div></dl>
        <p><Camera size={16} /> Use <b>Seguir</b> para encontrar seu avatar.</p>
      </div>}
    </section>}

    <p className={styles.hint} role="status">{props.hint}</p>
    <div className={styles.actions}>
      <button ref={helpTrigger} className={styles.helpTrigger} aria-label="Como jogar" aria-expanded={panel === "help"} aria-controls={panel === "help" ? panelId : undefined} onClick={() => setPanel(panel === "help" ? null : "help")}><CircleHelp size={19} /></button>
      {props.canSit && <Button variant="ghost" className={styles.action} disabled={props.disabled || panel !== null} onClick={props.onSit}><Armchair size={17} />{props.seated ? "Levantar" : "Sentar"}<kbd>E</kbd></Button>}
      <Button variant="ghost" className={styles.action} aria-pressed={props.dancing} disabled={props.disabled || panel !== null} onClick={props.onDance}><Music2 size={17} />{props.dancing ? "Parar dança" : "Dançar"}<kbd>Q</kbd></Button>
    </div>
  </>;
}
