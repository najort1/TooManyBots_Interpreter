import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Grupos",
  description: "Gerenciamento de grupos do bot: whitelist, configurações e controles por chat.",
};

export default function GroupsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
