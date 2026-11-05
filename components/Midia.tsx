"use client";

import { useEffect, useRef, useState } from "react";

// Miniatura de PDF (primeira página), PDF ampliado e player de áudio dos balões da conversa.

type PdfJs = typeof import("pdfjs-dist");
let pdfjsP: Promise<PdfJs> | null = null;
function carregarPdfJs() {
  pdfjsP ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return pdfjsP;
}

async function abrirPdf(src: string) {
  const pdfjs = await carregarPdfJs();
  const r = await fetch(src, { credentials: "same-origin" });
  if (!r.ok) throw new Error(String(r.status));
  return pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
}

// Miniaturas já desenhadas ficam guardadas enquanto a página estiver aberta.
const miniaturas = new Map<string, { img: string; paginas: number }>();

/** Primeira página do PDF em miniatura; só baixa quando o balão aparece na tela. */
export function PdfMiniatura({ src, nome, onAbrir }: { src: string; nome: string; onAbrir: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [mini, setMini] = useState(() => miniaturas.get(src) ?? null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (mini || erro || !ref.current) return;
    let vivo = true;
    const ob = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      ob.disconnect();
      try {
        const doc = await abrirPdf(src);
        const pag = await doc.getPage(1);
        const base = pag.getViewport({ scale: 1 });
        const viewport = pag.getViewport({ scale: (260 * 2) / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = Math.min(viewport.height, viewport.width * 1.3);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pag.render({ canvasContext: ctx, viewport }).promise;
        const m = { img: canvas.toDataURL("image/jpeg", 0.8), paginas: doc.numPages };
        miniaturas.set(src, m);
        doc.destroy();
        if (vivo) setMini(m);
      } catch {
        if (vivo) setErro(true);
      }
    }, { rootMargin: "200px" });
    ob.observe(ref.current);
    return () => {
      vivo = false;
      ob.disconnect();
    };
  }, [src, mini, erro]);
  return (
    <button ref={ref} type="button" className="pdf-mini" onClick={onAbrir} title="Ver o PDF">
      <span className="pdf-mini-pg">
        {mini ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mini.img} alt="primeira página do PDF" />
        ) : (
          <span className="pdf-mini-ph">{erro ? "📄 Sem pré-visualização" : "📄 Carregando…"}</span>
        )}
      </span>
      <span className="pdf-mini-nome">
        <span className="pdf-tag">PDF</span>
        <b>{nome}</b>
        {mini && <small>{mini.paginas} {mini.paginas === 1 ? "página" : "páginas"}</small>}
      </span>
    </button>
  );
}

/** PDF ampliado na própria tela: todas as páginas (até 30), uma embaixo da outra. */
export function PdfAmpliado({ src }: { src: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [mais, setMais] = useState(0);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const doc = await abrirPdf(src);
        const largura = Math.min(900, window.innerWidth - 40);
        const total = Math.min(doc.numPages, 30);
        for (let i = 1; i <= total && vivo; i++) {
          const pag = await doc.getPage(i);
          const base = pag.getViewport({ scale: 1 });
          const viewport = pag.getViewport({ scale: (largura * (window.devicePixelRatio || 1)) / base.width });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${largura}px`;
          await pag.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
          caixa.current?.appendChild(canvas);
          if (i === 1 && vivo) setEstado("ok");
        }
        if (vivo) setMais(doc.numPages - total);
        doc.destroy();
      } catch {
        if (vivo) setEstado("erro");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [src]);
  return (
    <div className="pdf-zoom" onClick={(e) => e.stopPropagation()}>
      {estado === "carregando" && <p className="pdf-zoom-msg">Abrindo o PDF…</p>}
      {estado === "erro" && <p className="pdf-zoom-msg">Não consegui mostrar o PDF aqui. Use “Abrir em nova aba”.</p>}
      <div ref={caixa} className="pdf-zoom-pgs" />
      {mais > 0 && <p className="pdf-zoom-msg">+ {mais} páginas: abra em nova aba para ver todas.</p>}
    </div>
  );
}

function tempo(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Player de áudio no balão: tocar/pausar, barra para avançar, tempo e velocidade. */
export function AudioPlayer({ src, carregarAntes = true }: { src: string; carregarAntes?: boolean }) {
  const a = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [atual, setAtual] = useState(0);
  const [dur, setDur] = useState(0);
  const [vel, setVel] = useState(1);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  function alternar() {
    const el = a.current;
    if (!el) return;
    if (el.paused) {
      // Pausa os outros áudios da tela, como no WhatsApp.
      document.querySelectorAll("audio").forEach((o) => o !== el && o.pause());
      setCarregando(true);
      el.play().catch(() => setErro(true)).finally(() => setCarregando(false));
    } else el.pause();
  }
  function mudarVel() {
    const v = vel === 1 ? 1.5 : vel === 1.5 ? 2 : 1;
    setVel(v);
    if (a.current) a.current.playbackRate = v;
  }
  const pct = dur ? (atual / dur) * 100 : 0;
  return (
    <div className={`aud${erro ? " erro" : ""}`}>
      <audio
        ref={a}
        src={src}
        preload={carregarAntes ? "metadata" : "none"}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => {
          setTocando(false);
          setAtual(0);
        }}
        onTimeUpdate={(e) => setAtual(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onError={() => {
          setErro(true);
          setCarregando(false);
        }}
      />
      <button type="button" className="aud-play" onClick={alternar} aria-label={tocando ? "Pausar" : "Tocar"} disabled={erro}>
        {carregando ? "…" : tocando ? "❚❚" : "▶"}
      </button>
      <div className="aud-meio">
        <input
          type="range"
          min={0}
          max={dur || 0}
          step={0.1}
          value={atual}
          disabled={!dur}
          aria-label="Posição do áudio"
          style={{ background: `linear-gradient(to right, #00a884 ${pct}%, #c9d3d8 ${pct}%)` }}
          onChange={(e) => {
            const t = Number(e.target.value);
            if (a.current) a.current.currentTime = t;
            setAtual(t);
          }}
        />
        <small>{erro ? "Áudio indisponível" : `${tempo(tocando || atual ? atual : dur)}${dur && (tocando || atual) ? ` / ${tempo(dur)}` : ""}`}</small>
      </div>
      <button type="button" className="aud-vel" onClick={mudarVel} aria-label="Velocidade">{vel}×</button>
    </div>
  );
}

/** Texto do áudio embaixo do player: aparece pronto ou com o botão "Transcrever". */
export function Transcricao({ conversa, msg, inicial }: { conversa: string; msg: string; inicial: string | null }) {
  const [texto, setTexto] = useState(inicial);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (inicial) setTexto(inicial);
  }, [inicial]);
  async function transcrever() {
    setBusy(true);
    setErro("");
    try {
      const r = await fetch(`/api/conversations/${conversa}/transcrever`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msg }),
      });
      const d = (await r.json().catch(() => ({}))) as { texto?: string; error?: string };
      if (!r.ok) throw new Error(d.error || "não consegui transcrever");
      setTexto(d.texto ?? "");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (texto) return <div className="aud-txt">📝 {texto}</div>;
  return (
    <div className="aud-tr">
      <button type="button" onClick={transcrever} disabled={busy}>{busy ? "Transcrevendo…" : "📝 Transcrever"}</button>
      {erro && <small>{erro}</small>}
    </div>
  );
}
