"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

function Coluna({ conn, stats, onAbrir, aberta, lateMin = LATE_MIN, max = false, onMax }: { conn: Conn; stats?: Stats; onAbrir: (id: string) => void; aberta: string | null; lateMin?: number; max?: boolean; onMax?: () => void }) {
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
  // Passar o mouse por um filtro (ou contador) já mostra a lista dele, sem precisar clicar.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passar = (key: string) => ({
    onMouseEnter: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFiltro(key), 250);
    },
    onMouseLeave: () => {
      if (timer.current) clearTimeout(timer.current);
    },
    onClick: () => setFiltro(key),
  });
  return (
    <section className={`cc-col${online ? "" : " off"}${max ? " max" : ""}`}>
      <header className="cc-h" onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button,input")) onMax?.(); }}>
        <div className="cc-t">
          <span className={`num-dot ${online ? "ok" : "off"}`} />
          <div>
            <b>{conn.name}</b>
            <small>{conn.phone ? formatPhone(conn.phone) : "sem número"} · {online ? "conectado" : "desconectado"}</small>
          </div>
          {onMax && (
            <button className="cc-max" onClick={onMax} title={max ? "Voltar para todas as caixas (Esc)" : "Abrir esta caixa na tela toda"}>
              {max ? "⤡ Reduzir" : "⤢ Expandir"}
            </button>
          )}
        </div>
        <div className="cc-stats">
          <span className="w" title="Aguardando resposta" {...passar("pendentes")}><b>{stats?.pendentes ?? "–"}</b>aguardando</span>
          <span className="g" title="Em atendimento" {...passar("todas")}><b>{stats?.abertas ?? "–"}</b>atendendo</span>
          <span className="v" title="Com a IA" {...passar("robo")}><b>{stats?.robo ?? "–"}</b>IA</span>
          <span title="Conversas abertas" {...passar("todas")}><b>{stats?.todas ?? "–"}</b>abertas</span>
        </div>
        {!online && <p className="cc-alerta">Desconectado: as mensagens deste número não estão chegando.</p>}
        <div className="cc-f">
          {FILTROS.map((f) => (
            <button key={f.key} className={filtro === f.key ? "on" : ""} {...passar(f.key)}>
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
  // Arrumação: "lado" = colunas lado a lado (rola para o lado); "grade" = todas na tela (até 6: 3 em cima e 3 embaixo).
  const [modo, setModo] = useState<"lado" | "grade">("grade");
  const [ocultos, setOcultos] = useState<string[]>([]);
  const [maxId, setMaxId] = useState<string | null>(null);
  // Conversa aberta na tela toda (com painel do cliente, pedidos e ferramentas) ou numa janela lateral.
  const [cheia, setCheia] = useState(true);
  useEffect(() => {
    try { setCheia(localStorage.getItem("oz.centralCheia") !== "0"); } catch {}
  }, []);
  const mudarCheia = (v: boolean) => {
    setCheia(v);
    try { localStorage.setItem("oz.centralCheia", v ? "1" : "0"); } catch {}
  };
  // No PC a conversa abre ao lado das caixas, no espaço livre da tela (sem cobrir as caixas).
  const [dock, setDock] = useState(true);
  const [largo, setLargo] = useState(false);
  useEffect(() => {
    try { setDock(localStorage.getItem("oz.centralDock") !== "0"); } catch {}
    const mq = window.matchMedia("(min-width: 1000px)");
    const f = () => setLargo(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const mudarDock = (v: boolean) => {
    setDock(v);
    if (!v) mudarCheia(true);
    try { localStorage.setItem("oz.centralDock", v ? "1" : "0"); } catch {}
  };
  const lado = !!aberta && dock && largo;
  // Barra lateral da Central pode ser escondida para sobrar mais espaço para as caixas e a conversa.
  const [semLateral, setSemLateral] = useState(false);
  useEffect(() => {
    try { setSemLateral(localStorage.getItem("oz.centralSemLateral") === "1"); } catch {}
  }, []);
  const mudarLateral = (v: boolean) => {
    setSemLateral(v);
    try { localStorage.setItem("oz.centralSemLateral", v ? "1" : "0"); } catch {}
  };
  useEffect(() => {
    try {
      const m = localStorage.getItem("oz.centralModo");
      if (m === "lado" || m === "grade") setModo(m);
      setOcultos(JSON.parse(localStorage.getItem("oz.centralOcultos") || "[]"));
    } catch {}
  }, []);
  const mudarModo = (m: "lado" | "grade") => {
    setModo(m);
    try { localStorage.setItem("oz.centralModo", m); } catch {}
  };
  const mudarOcultos = (o: string[]) => {
    setOcultos(o);
    try { localStorage.setItem("oz.centralOcultos", JSON.stringify(o)); } catch {}
  };

  useEffect(() => {
    const ler = () => api<Summary>("/api/conversations/summary?view=todas&queue=todas").then(setSum).catch((e) => setErro(e.message));
    ler();
    const t = setInterval(() => !document.hidden && ler(), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAberta((a) => {
        if (!a) setMaxId(null);
        return null;
      });
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  return (
    <div className={`cc cc-lat${lado ? " com-dock" : ""}${semLateral ? " sem-lateral" : ""}`}>
      <div className="cc-side-wrap">
      <button
        className="lado-tg cc-tg"
        onClick={() => mudarLateral(!semLateral)}
        title={semLateral ? "Mostrar a barra das caixas" : "Esconder a barra das caixas"}
        aria-label={semLateral ? "Mostrar a barra das caixas" : "Esconder a barra das caixas"}
        aria-expanded={!semLateral}
      >
        {semLateral ? "›" : "‹"}
      </button>
      <aside className="cc-side">

      <div className="cc-top">
        <h1>Central de atendimento</h1>
        <span className="muted">Uma caixa para cada número/canal · atualiza sozinha · clique numa conversa para responder</span>
        <span className="cc-modo">
          <button className={modo === "grade" ? "on" : ""} onClick={() => mudarModo("grade")} title="Todas as caixas na tela (3 em cima, 3 embaixo)">▦ Todas na tela</button>
          <button className={modo === "lado" ? "on" : ""} onClick={() => mudarModo("lado")} title="Colunas lado a lado, rolando para o lado">▥ Lado a lado</button>
        </span>
      </div>
      {sum && sum.connections.length > 1 && (
        <div className="cc-chips" role="group" aria-label="Caixas que aparecem na tela">
          <span className="cc-chips-t">Caixas na tela:</span>
          {sum.connections.map((c) => {
            const on = !ocultos.includes(c.id);
            return (
              <button
                key={c.id}
                className={on ? "on" : ""}
                aria-pressed={on}
                title={on ? "Clique para tirar esta caixa da tela" : "Clique para mostrar esta caixa"}
                onClick={() => mudarOcultos(on ? [...ocultos, c.id] : ocultos.filter((x) => x !== c.id))}
              >
                <span aria-hidden="true">{on ? "✓" : "+"}</span> {c.name}
              </button>
            );
          })}
          {ocultos.length > 0 && (
            <button className="cc-chips-all" onClick={() => mudarOcultos([])}>Mostrar todas</button>
          )}
        </div>
      )}
      {erro && <p style={{ color: "var(--danger)", padding: "0 16px" }}>{erro}</p>}
      {!!sum?.views?.atrasadas && (
        <p className="cc-alerta espera" style={{ margin: "0 16px 8px" }} role="alert">
          ⚠ {sum.views.atrasadas} {sum.views.atrasadas === 1 ? "cliente esperando" : "clientes esperando"} resposta há mais de {sum.alertas?.espera_min ?? LATE_MIN} min (em vermelho nas caixas).
        </p>
      )}
      </aside>
      </div>
      <div className={`cc-cols${modo === "grade" ? " grade" : ""}`}>
        {!sum && <p className="muted" style={{ padding: 16 }}>Carregando…</p>}
        {sum?.connections.filter((c) => !ocultos.includes(c.id)).map((c) => (
          <Coluna key={c.id} conn={c} stats={sum.numeros?.[c.id]} onAbrir={setAberta} aberta={aberta} lateMin={sum.alertas?.espera_min} max={maxId === c.id} onMax={() => setMaxId(maxId === c.id ? null : c.id)} />
        ))}
      </div>
      {lado && (
        <section className="cc-dock" aria-label="Conversa aberta">
          <div className="cc-dbar">
            <button onClick={() => setAberta(null)}>× Fechar conversa</button>
            <button className="cc-dmodo" onClick={() => mudarDock(false)} title="Abrir a conversa na tela toda">⤢ Tela toda</button>
          </div>
          <iframe key={aberta} src={`/?c=${aberta}&embed=1`} title="Conversa" />
        </section>
      )}
      {aberta && !lado && (
        <div className="cc-drawer-bg" onClick={() => setAberta(null)}>
          <div className={`cc-drawer${cheia ? " cheia" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="cc-dbar">
              <button onClick={() => setAberta(null)}>← Voltar para a Central</button>
              {largo ? (
                <button className="cc-dmodo" onClick={() => mudarDock(true)} title="Abrir a conversa ao lado das caixas">⇤ Abrir ao lado das caixas</button>
              ) : (
                <button className="cc-dmodo" onClick={() => mudarCheia(!cheia)} title={cheia ? "Abrir a conversa numa janela lateral" : "Abrir a conversa na tela toda"}>
                  {cheia ? "⤡ Janela lateral" : "⤢ Tela toda"}
                </button>
              )}
            </div>
            <iframe key={aberta} src={`/?c=${aberta}&embed=1`} title="Conversa" />
          </div>
        </div>
      )}
    </div>
  );
}
