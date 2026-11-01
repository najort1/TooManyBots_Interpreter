import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Config",
  description: "Preferências gerais do painel e do bot.",
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
