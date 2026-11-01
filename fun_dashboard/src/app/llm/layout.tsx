import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "IA & LLM",
  description: "Configuração e monitoramento do cérebro de IA do bot.",
};

export default function LlmLayout({ children }: { children: React.ReactNode }) {
  return children;
}
