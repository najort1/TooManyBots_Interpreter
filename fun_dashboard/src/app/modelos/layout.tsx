import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Modelos LLM",
  description: "Modelos disponíveis, custos e uso de tokens do bot.",
};

export default function ModelosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
