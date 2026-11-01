import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ranking",
  description: "Classificação de membros por moedas, níveis e atividade no grupo.",
};

export default function RankingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
