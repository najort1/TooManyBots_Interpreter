import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Visão geral",
  description: "Panorama operacional do bot: métricas de grupos, atividade e saúde em tempo real.",
};

export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
