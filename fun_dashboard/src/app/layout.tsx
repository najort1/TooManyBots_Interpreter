import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ScopeProvider } from "@/components/layout/ScopeProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
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

/** Evita flash de tema errado antes do React hidratar. */
const themeBootScript = `
(function(){
  try {
    var k = 'fun-dashboard-theme';
    var t = localStorage.getItem(k);
    if (t !== 'dark' && t !== 'light') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (t === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = t;
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased`}
      >
        <ThemeProvider>
          <ScopeProvider>{children}</ScopeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
