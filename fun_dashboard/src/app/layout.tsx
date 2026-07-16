import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ScopeProvider } from "@/components/layout/ScopeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fun · Ops",
  description: "Dashboard operacional do bot Fun",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ScopeProvider>{children}</ScopeProvider>
      </body>
    </html>
  );
}
