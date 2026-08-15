import type { Metadata } from "next";
export const metadata: Metadata = { title: "Casas do Beco", description: "Sua casa no grupo", robots: { index: false, follow: false } };
export default function CasasLayout({ children }: { children: React.ReactNode }) { return children; }
