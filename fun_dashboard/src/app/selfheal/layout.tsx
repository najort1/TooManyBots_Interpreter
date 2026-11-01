import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Auto-aprimorar",
  description: "Ciclo de auto-aprimoramento: propostas, aprendizados e correções automáticas.",
};

export default function SelfhealLayout({ children }: { children: React.ReactNode }) {
  return children;
}
