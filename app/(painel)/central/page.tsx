"use client";

import { useCallback, useEffect, useState } from "react";
import { api, avatarColor, formatListTime, formatPhone, formatPreview, formatSince, initials } from "@/lib/client";

// Central de atendimento: uma coluna para cada número de WhatsApp, lado a lado, atualizando sozinha.
type Conn = { id: string; name: string; phone?: string | null; connected_at: string | null };
type Stats = { todas: number; pendentes: number; abertas: number; robo: number };
type Summary = { connections: Conn[]; numeros?: Record<string, Stats>; views?: Record<string, number>; alertas?: { espera_min: number; retomar_dias: number } };
type Row = {
  id: string;
  status: string;
  unread_count: number;
  last_message_at: string;
  last_message_preview: string | null;
  waiting_since: string | null;
  contact: { id: string; name: string | null; phone: string; is_group: boolean };
  agent: { id: string; name: string } | null;
};

const FILTROS = [
  { key: "pendentes", label: "Aguardando" },
  { key: "todas", label: "Abertas" },
  { key: "robo", label: "Com a IA" },
  { key: "retomar", label: "Retomar" },
  { key: "fechadas", label: "Fechadas" },
] as const;
const LATE_MIN = 30;

function Coluna({ conn, stats, onAbrir, aberta, lateMin = LATE_MIN }: { conn: Conn; stats?: Stats; onAbrir: (id: string) => void; aberta: string | null; lateMin?: number }) {
  const [filtro, setFiltro] = useState<string>(() => {
    try {
      return localStorage.getItem(`central_${conn.id}`) || "todas";
    } catch {
      return "todas";
    }
  });
  const [lista, setLista] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");

  const carregar = useCallback(async () => {
    const p = new URLSearchParams({ view: filtro, queue: "todas", connection: conn.id });
    if (q.trim()) p.set("q", q.trim());
    setLista(await api<Row[]>(`/api/conversations?${p}`));
  }, [filtro, conn.id, q]);

  useEffect(() => {
    try {
      localStorage.setItem(`central_${conn.id}`, filtro);
    } catch {}
  }, [filtro, conn.id]);

  useEffect(() => {
    const t0 = setTimeout(() => carregar().catch(() => {}), q ? 300 : 0);
    const t = setInterval(() => !document.hidden && carregar().catch(() => {}), 10000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [carregar, q]);

  const online = !!conn.connected_at;
  return (
    <section className={`cc-col${online ? "" : " off"}`}>
      <header className="cc-h">
        <div className="cc-t">
          <span className={`num-dot ${online ? "ok" : "off"}`} />
          <div>
            <b>{conn.name}</b>
            <small>{conn.phone ? formatPhone(conn.phone) : "sem número"} · {online ? "conectado" : "desconectado"}</small>
          </div>
        </div>
        <div className="cc-stats">
          <span className="w" title="Aguardando resposta"><b>{stats?.pendentes ?? "–"}</b>aguardando</span>
          <span className="g" title="Em atendimento"><b>{stats?.abertas ?? "–"}</b>atendendo</span>
          <span className="v" title="Com a IA"><b>{stats?.robo ?? "–"}</b>IA</span>
          <span title="Conversas abertas"><b>{stats?.todas ?? "–"}</b>abertas</span>
        </div>
        {!online && <p className="cc-alerta">Desconectado: as mensagens deste número não estão chegando.</p>}
        <div className="cc-f">
          {FILTROS.map((f) => (
            <button key={f.key} className={filtro === f.key ? "on" : ""} onClick={() => setFiltro(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <input className="cc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nesta coluna…" />
      </header>
      <div className="cc-list">
        {lista === null && <p className="muted cc-vazio">Carregando…</p>}
        {lista?.length === 0 && <p className="muted cc-vazio">Nenhuma conversa aqui.</p>}
        {lista?.map((c) => {
          const nome = c.contact.name || (c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone));
          const espera = c.waiting_since && c.status !== "closed" && !c.contact.is_group ? c.waiting_since : null;
          const late = espera && Date.now() - new Date(espera).getTime() > lateMin * 60_000;
          return (
            <button key={c.id} className={`cc-item${aberta === c.id ? " on" : ""}${c.unread_count ? " nova" : ""}`} onClick={() => onAbrir(c.id)}>
              <span className="ib-avatar" style={{ background: avatarColor(c.contact.id), width: 36, height: 36, fontSize: 13 }}>{initials(nome)}</span>
              <span className="cc-body">
                <span className="cc-l1">
                  <b>{nome}</b>
                  <small>{formatListTime(c.last_message_at)}</small>
                </span>
                <span className="cc-prev">{formatPreview(c.last_message_preview) || " "}</span>
                <span className="cc-l3">
                  {espera && <span className={`cc-wait${late ? " late" : ""}`}>⏳ {formatSince(espera)}</span>}
                  {c.status === "bot" && <span className="cc-chip">🤖 IA</span>}
                  {c.agent && <span className="cc-chip">👤 {c.agent.name}</span>}
                  {c.unread_count > 0 && <span className="cc-un">{c.unread_count > 99 ? "99+" : c.unread_count}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function CentralPage() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const ler = () => api<Summary>("/api/conversations/summary?view=todas&queue=todas").then(setSum).catch((e) => setErro(e.message));
    ler();
    const t = setInterval(() => !document.hidden && ler(), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberta(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  return (
    <div className="cc">
      <div className="cc-top">
        <h1>Central de atendimento</h1>
        <span className="muted">Uma coluna para cada número de WhatsApp · atualiza sozinha · clique numa conversa para responder</span>
      </div>
      {erro && <p style={{ color: "var(--danger)", padding: "0 16px" }}>{erro}</p>}
      {!!sum?.views?.atrasadas && (
        <p className="cc-alerta espera" style={{ margin: "0 16px 8px" }} role="alert">
          ⚠ {sum.views.atrasadas} {sum.views.atrasadas === 1 ? "cliente esperando" : "clientes esperando"} resposta há mais de {sum.alertas?.espera_min ?? LATE_MIN} min (em vermelho nas colunas).
        </p>
      )}
      <div className="cc-cols">
        {!sum && <p className="muted" style={{ padding: 16 }}>Carregando…</p>}
        {sum?.connections.map((c) => (
          <Coluna key={c.id} conn={c} stats={sum.numeros?.[c.id]} onAbrir={setAberta} aberta={aberta} lateMin={sum.alertas?.espera_min} />
        ))}
      </div>
      {aberta && (
        <div className="cc-drawer-bg" onClick={() => setAberta(null)}>
          <div className="cc-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="cc-fechar" onClick={() => setAberta(null)} aria-label="Fechar conversa">×</button>
            <iframe key={aberta} src={`/?c=${aberta}&embed=1`} title="Conversa" />
          </div>
        </div>
      )}
    </div>
  );
}
