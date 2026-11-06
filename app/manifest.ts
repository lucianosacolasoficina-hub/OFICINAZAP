import type { MetadataRoute } from "next";

// Faz o OficinaZap poder ser instalado no celular como um aplicativo (ícone na tela inicial, tela cheia).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OficinaZap",
    short_name: "OficinaZap",
    description: "Atendimento WhatsApp da Sacolas Oficina",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f2e1d",
    theme_color: "#0f2e1d",
    lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Conversas", url: "/", icons: [{ src: "/icon-96.png", sizes: "96x96" }] },
      { name: "Central", url: "/central", icons: [{ src: "/icon-96.png", sizes: "96x96" }] },
    ],
  };
}
