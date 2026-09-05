import type { Metadata } from "next";
import { CasasGraphicsProvider } from "@/components/casas/CasasGraphicsProvider";
import "./experience.css";
export const metadata: Metadata = { title: "Casas do Beco", description: "Sua casa no grupo", robots: { index: false, follow: false } };
export default function CasasLayout({ children }: { children: React.ReactNode }) {
  return <CasasGraphicsProvider>{children}</CasasGraphicsProvider>;
}
