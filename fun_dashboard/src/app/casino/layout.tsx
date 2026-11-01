import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cassino",
  description: "Jogos de azar do bot: resultados, prêmios e saúde do cassino.",
};

export default function CasinoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
