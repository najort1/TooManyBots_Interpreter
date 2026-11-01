import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Histórico de mudanças e novidades publicadas no bot.",
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
