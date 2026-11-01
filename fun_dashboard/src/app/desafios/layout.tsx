import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Desafios",
  description: "Desafios de engajamento do grupo: criação, status e participação.",
};

export default function DesafiosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
