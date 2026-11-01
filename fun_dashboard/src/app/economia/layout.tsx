import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gestão de Economia",
  description: "Controle monetário, inflação, distribuição de riqueza e intervenção do regulador.",
};

export default function EconomiaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
