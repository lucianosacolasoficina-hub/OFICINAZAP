import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppCelular } from "@/components/AppCelular";

export const metadata: Metadata = {
  title: "OficinaZap",
  description: "Atendimento WhatsApp com IA",
  applicationName: "OficinaZap",
  appleWebApp: { capable: true, title: "OficinaZap", statusBarStyle: "black" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f2e1d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <AppCelular />
      </body>
    </html>
  );
}
