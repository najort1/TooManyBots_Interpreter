import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Logs ao Vivo",
  description: "Stream de eventos do bot em tempo real: mensagens, comandos e ações.",
};

export default function LogsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
