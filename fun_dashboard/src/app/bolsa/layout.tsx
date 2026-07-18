import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Corretora do Beco",
  description: "Bolsa do grupo — cotações e gráficos. Compra e venda só no WhatsApp.",
  robots: { index: false, follow: false },
};

/**
 * Superfície isolada da corretora — sem shell admin, sem seletor de grupo.
 */
export default function BolsaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
