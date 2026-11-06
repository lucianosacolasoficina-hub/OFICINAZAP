"use client";

import { useEffect, useState } from "react";

type PedidoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Liga o "modo aplicativo": registra o service worker e, no celular, oferece instalar o OficinaZap na tela inicial.
export function AppCelular() {
  const [pedido, setPedido] = useState<PedidoInstalar | null>(null);
  const [iphone, setIphone] = useState(false);
  const [fechado, setFechado] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const instalado = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const celular = window.matchMedia("(max-width: 900px)").matches;
    let dispensado = false;
    try { dispensado = localStorage.getItem("oz.instalarFechado") === "1"; } catch {}
    if (instalado || !celular || dispensado) return;
    setFechado(false);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIphone(ios);
    const onPedido = (e: Event) => { e.preventDefault(); setPedido(e as PedidoInstalar); };
    const onInstalado = () => setFechado(true);
    window.addEventListener("beforeinstallprompt", onPedido);
    window.addEventListener("appinstalled", onInstalado);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPedido);
      window.removeEventListener("appinstalled", onInstalado);
    };
  }, []);

  const fechar = () => {
    setFechado(true);
    try { localStorage.setItem("oz.instalarFechado", "1"); } catch {}
  };
  if (fechado || (!pedido && !iphone)) return null;
  return (
    <div className="app-instalar" role="dialog" aria-label="Instalar o app OficinaZap">
      <img src="/icon-96.png" alt="" width={40} height={40} />
      <div className="app-instalar-t">
        <strong>Instale o app OficinaZap</strong>
        {iphone ? (
          <span>No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</span>
        ) : (
          <span>Fica com ícone no celular e abre em tela cheia.</span>
        )}
      </div>
      {pedido && (
        <button
          className="primary"
          onClick={async () => {
            await pedido.prompt().catch(() => {});
            const r = await pedido.userChoice.catch(() => ({ outcome: "" }));
            if (r.outcome === "accepted") setFechado(true);
            setPedido(null);
          }}
        >
          Instalar
        </button>
      )}
      <button className="app-instalar-x" onClick={fechar} aria-label="Fechar">×</button>
    </div>
  );
}
