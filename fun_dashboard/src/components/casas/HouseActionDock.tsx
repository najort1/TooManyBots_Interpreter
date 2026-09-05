"use client";

import { BookOpen, Gift, MessageSquare, Package, RotateCw, Shield, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  busy: boolean;
  selectedName?: string;
  onCollect: () => void;
  onInventory: () => void;
  onCatalog: () => void;
  onSecurity: () => void;
  onMural: () => void;
  onRotate: () => void;
  onSell: () => void;
  onClear: () => void;
};

export default function HouseActionDock(props: Props) {
  const actions = [
    { label: "Coletar", title: "Coletar recompensa diária", icon: Gift, action: props.onCollect },
    { label: "Móveis", title: "Abrir seus móveis", icon: Package, action: props.onInventory },
    { label: "Catálogo", title: "Abrir catálogo", icon: BookOpen, action: props.onCatalog },
    { label: "Segurança", title: "Melhorar segurança", icon: Shield, action: props.onSecurity },
    { label: "Mural", title: "Abrir mural de visitas", icon: MessageSquare, action: props.onMural },
  ];
  return <div className="casas-house-tools">
    {props.selectedName && <section className="casas-selection-toolbar" aria-label="Móvel selecionado">
      <span>{props.selectedName}</span>
      <Button variant="ghost" disabled={props.busy} onClick={props.onRotate} title="Girar móvel"><RotateCw size={16} />Girar</Button>
      <Button variant="ghost" disabled={props.busy} onClick={props.onSell} title="Vender móvel"><Trash2 size={16} />Vender</Button>
      <Button variant="ghost" onClick={props.onClear} aria-label="Desmarcar móvel"><X size={16} /></Button>
    </section>}
    <nav className="casas-house-dock" aria-label="Ações da casa">
      {actions.map(({ label, title, icon: Icon, action }) => <Button key={label} variant="ghost" disabled={props.busy} onClick={action} title={title}><Icon size={19} /><span>{label}</span></Button>)}
    </nav>
  </div>;
}
