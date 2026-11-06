"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { notificar } from "@/lib/notificar";

type Item = { id: string; tel: string; nome: string; v?: string };

// Mantém o OficinaZap aberto "ouvindo" o sistema de gestão, em qualquer tela do painel.
// Quando alguém clica no sistema (WhatsApp do cliente, mensagem pronta, listas), o pedido chega
// aqui e abre nesta mesma aba, sem o sistema abrir outra janela. Também avisa o servidor que a
// aba está aberta (é isso que o sistema consulta antes de decidir se abre janela nova).
export function GestaoAoVivo() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (window.self !== window.top) return; // dentro da Central (iframe): quem escuta é a aba de fora
    if (new URLSearchParams(window.location.search).get("embed") === "1") return;
    try { window.name = "oficinazap"; } catch {}
    let vivo = true;
    const dorme = (ms: number) => new Promise((s) => setTimeout(s, ms));
    const ctl = new AbortController();
    (async () => {
      while (vivo) {
        try {
          const r = await fetch("/api/rascunhos/fila?wait=25", { cache: "no-store", signal: ctl.signal });
          if (r.status === 401) { await dorme(30000); continue; }
          if (!r.ok) { await dorme(5000); continue; }
          const j = (await r.json()) as { itens?: Item[] };
          const it = (j.itens ?? [])[0];
          if (!it || !vivo) continue;
          avisar(it);
          if (window.location.pathname === "/") {
            window.dispatchEvent(new CustomEvent("oficinazap:abrir", { detail: it }));
          } else if (it.tel || it.id) {
            const q = new URLSearchParams({ tel: it.tel || "", nome: it.nome || "" });
            if (it.id) q.set("r", it.id);
            window.location.assign("/abrir?" + q.toString());
          } else {
            router.push(it.v ? "/?v=" + encodeURIComponent(it.v) : "/");
          }
          try { window.focus(); } catch {}
        } catch {
          if (!vivo) break;
          await dorme(5000);
        }
      }
    })();
    return () => { vivo = false; ctl.abort(); };
    // Reinicia ao trocar de tela para não ficar com duas esperas abertas.
  }, [pathname, router]);
  return null;
}

function avisar(it: Item) {
  const quem = it.nome || it.tel || "";
  try {
    if (document.hidden) {
      notificar(it.id ? "OficinaZap · mensagem pronta" : "OficinaZap", {
        body: it.id ? `Para ${quem || "o cliente"}: confira e toque em Enviar.` : quem ? `Conversa de ${quem} aberta.` : "Aberto pelo sistema de gestão.",
        tag: "gestao-" + (it.id || it.tel || it.v || "abrir"),
      });
    }
  } catch {}
  try {
    const antes = document.title;
    document.title = it.id ? "💬 Mensagem pronta · OficinaZap" : "💬 OficinaZap";
    setTimeout(() => { document.title = antes; }, 15000);
  } catch {}
}
