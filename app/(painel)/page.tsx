"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useMe } from "@/lib/useMe";
import { msgCadastro } from "@/lib/cadastroMsg";
import { HistoricoPedidos } from "@/components/HistoricoPedidos";
import { EtapasCrm, type Etapa } from "@/components/EtapasCrm";
import {
  api,
  avatarColor,
  formatListTime,
  formatPhone,
  formatPreview,
  formatSince,
  formatTime,
  initials,
  STATUS_LABEL,
} from "@/lib/client";
import type { Contact, Conversation, ConversationStatus, Department, Message, QuoteData } from "@/lib/db";

type DeptTag = Pick<Department, "id" | "name" | "color">;
type ConvRow = Conversation & {
  contact: Contact;
  department: DeptTag | null;
  agent: { id: string; name: string } | null;
  connection?: { id: string; name: string; phone: string | null } | null;
};
type NumStats = { todas: number; pendentes: number; abertas: number; robo: number };
type Detail = { conversation: ConvRow; messages: Message[]; quote: QuoteData | null };
type QuickReply = { id: string; shortcut: string; body: string };
type Summary = {
  views: Record<string, number>;
  queues: Record<string, number>;
  stages: Record<string, number>;
  etapas?: Etapa[];
  connections: { id: string; name: string; phone?: string | null; connected_at: string | null }[];
  numeros?: Record<string, NumStats>;
  me: string;
  atendentes?: { id: string; name: string; abertas: number }[];
  /** Limites do alerta de espera e da retomada de orçamentos (Configurações). */
  alertas?: { espera_min: number; retomar_dias: number };
};

const VIEWS = [
  { key: "todas", label: "Todas", icon: "chat" },
  { key: "minhas", label: "Minhas", icon: "user" },
  { key: "pendentes", label: "Pendentes", icon: "hourglass" },
  { key: "naolidas", label: "Não lidas", icon: "chat" },
  { key: "atendimento", label: "Em atendimento", icon: "team" },
  { key: "enviadas", label: "Enviadas", icon: "send" },
  { key: "retomar", label: "Retomar", icon: "retry" },
  { key: "grupos", label: "Grupos", icon: "users" },
  { key: "robo", label: "Robô", icon: "bot" },
  { key: "equipe", label: "Equipe", icon: "team" },
  { key: "fechadas", label: "Fechadas", icon: "check" },
];

const QUEUES = [
  { key: "todas", label: "Todas", icon: "chat" },
  { key: "minhas", label: "Minhas", icon: "user" },
  { key: "departamento", label: "Departamento", icon: "building" },
  { key: "geral", label: "Geral", icon: "users" },
];


const POLL_MS = 8000; // lista de conversas
const MSG_MS = 3000; // mensagens novas da conversa aberta (só as novas)
const SUMMARY_MS = 30000; // contadores
const visivel = () => typeof document === "undefined" || !document.hidden;
/** Acima disso o tempo de espera fica vermelho (até carregar o valor de Configurações). */
const LATE_MIN = 30;
const RETOMAR_DIAS = 2;

/** Bipe curto (sem arquivo de som) para avisar que tem cliente esperando demais. */
function bipe() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    o.onended = () => ctx.close();
  } catch {}
}

function count(n: number | undefined) {
  if (n === undefined) return "";
  return n > 99 ? "+99" : String(n);
}

/** Guarda preferências simples da tela (seções abertas etc.) no navegador. */
function usePref<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`oz.${key}`);
      if (saved !== null) setValue(JSON.parse(saved));
    } catch {}
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(`oz.${key}`, JSON.stringify(v));
      } catch {}
    },
    [key],
  );
  return [value, set] as const;
}

export default function InboxPage() {
  const [view, setView] = usePref("view", "todas");
  const [queue, setQueue] = usePref("queue", "todas");
  const [stage, setStage] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [numero, setNumero] = usePref("numero", "");
  // Quais números/canais aparecem na barra do topo (escolha de cada pessoa, guardada neste aparelho).
  const [numOcultos, setNumOcultos] = usePref<string[]>("numOcultos", []);
  const [numMin, setNumMin] = usePref("numMin", false);
  const [numCfg, setNumCfg] = useState(false);
  // Quadros: a tela de conversas dividida em quadros, um por número/canal, sempre abertos.
  const [quadros, setQuadros] = usePref("quadros", true);
  const [quadroAberto, setQuadroAberto] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState("");
  const [teamOpen, setTeamOpen] = usePref("teamOpen", true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = usePref("sidebar2", false);
  const [infoOpen, setInfoOpen] = usePref("infoOpen", false);
  const [histOpen, setHistOpen] = usePref("histOpen", false);
  const [editEtapas, setEditEtapas] = useState(false);
  const meInbox = useMe();
  const [crmOpen, setCrmOpen] = usePref("crmOpen", true);
  const [queueOpen, setQueueOpen] = usePref("queueOpen", true);
  const [filterPop, setFilterPop] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [list, setList] = useState<ConvRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Aberta dentro da Central (iframe ?embed=1): só a conversa e as ferramentas, sem a lista.
  const [embed, setEmbed] = useState(false);
  useEffect(() => {
    setEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
    // Atalho vindo do sistema de gestão: /?v=pendentes abre direto nessa lista.
    const v = new URLSearchParams(window.location.search).get("v");
    if (v && VIEWS.some((x) => x.key === v)) setView(v);
  }, []);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [, setTick] = useState(0);

  // Espera o atendente parar de digitar antes de buscar.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ view, queue });
    if (stage) p.set("stage", stage);
    if (deptFilter) p.set("department", deptFilter);
    if (agentFilter) p.set("agent", agentFilter);
    if (numero) p.set("connection", numero);
    return p;
  }, [view, queue, stage, deptFilter, agentFilter, numero]);

  // Cada busca tem um número; resposta atrasada de um filtro antigo é ignorada
  // (senão a lista de "todos os números" podia aparecer por cima do número escolhido).
  const listSeq = useRef(0);
  const sumSeq = useRef(0);
  const loadList = useCallback(async () => {
    const p = new URLSearchParams(params);
    if (query) p.set("q", query);
    const meu = ++listSeq.current;
    const data = await api<ConvRow[]>(`/api/conversations?${p}`);
    if (meu === listSeq.current) setList(data);
  }, [params, query]);

  const loadSummary = useCallback(async () => {
    const meu = ++sumSeq.current;
    const data = await api<Summary>(`/api/conversations/summary?${params}`);
    if (meu === sumSeq.current) setSummary(data);
  }, [params]);

  // Trocou o filtro (número, situação, busca…): mostra "Carregando…" até chegar a lista certa.
  useEffect(() => {
    setList(null);
  }, [params, query]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    const d = await api<Detail>(`/api/conversations/${selected}`);
    // Só mostra se ainda for a conversa escolhida (clicou em outra enquanto carregava).
    setDetail((cur) => (d.conversation.id === selected ? d : cur));
  }, [selected]);

  // Só atualiza com a aba aberta na tela (economiza o servidor e deixa tudo mais rápido).
  useEffect(() => {
    loadList().catch(console.error);
    const t = setInterval(() => visivel() && loadList().catch(console.error), POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    loadSummary().catch(console.error);
    const t = setInterval(() => visivel() && loadSummary().catch(console.error), SUMMARY_MS);
    return () => clearInterval(t);
  }, [loadSummary]);

  const lateMin = summary?.alertas?.espera_min ?? LATE_MIN;
  const retomarDias = summary?.alertas?.retomar_dias ?? RETOMAR_DIAS;
  const atrasadas = summary?.views.atrasadas ?? 0;
  const [avisoPerm, setAvisoPerm] = useState<string>("granted");
  useEffect(() => {
    if (typeof Notification !== "undefined") setAvisoPerm(Notification.permission);
  }, []);
  // Alerta de cliente esperando: número na aba do navegador e, quando aumenta, bipe + notificação.
  const atrasadasAntes = useRef<number | null>(null);
  useEffect(() => {
    if (!summary) return;
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = atrasadas > 0 ? `(${atrasadas > 99 ? "99+" : atrasadas}) ${base}` : base;
    const antes = atrasadasAntes.current;
    atrasadasAntes.current = atrasadas;
    if (antes === null || atrasadas <= antes) return;
    bipe();
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("OficinaZap: cliente esperando", {
          body: `${atrasadas} ${atrasadas === 1 ? "cliente está" : "clientes estão"} esperando resposta há mais de ${lateMin} min.`,
          tag: "oz-espera",
        });
      }
    } catch {}
  }, [summary, atrasadas, lateMin]);
  useEffect(() => () => { document.title = document.title.replace(/^\(\d+\+?\) /, ""); }, []);

  const detailRef = useRef<Detail | null>(null);
  detailRef.current = detail;
  // Conversa aberta: busca tudo uma vez e depois só as mensagens novas.
  const pollMsgs = useCallback(async () => {
    const d = detailRef.current;
    if (!selected || !d || d.conversation.id !== selected) return;
    const last = d.messages[d.messages.length - 1]?.created_at;
    const novos = await api<Message[]>(`/api/conversations/${selected}/messages${last ? `?after=${encodeURIComponent(last)}` : ""}`);
    if (!novos.length) return;
    setDetail((cur) =>
      cur && cur.conversation.id === selected
        ? { ...cur, messages: [...cur.messages, ...novos.filter((n) => !cur.messages.some((m) => m.id === n.id))] }
        : cur,
    );
  }, [selected]);

  useEffect(() => {
    setDetail(null);
    loadDetail().catch(console.error);
    const t1 = setInterval(() => visivel() && pollMsgs().catch(console.error), MSG_MS);
    const t2 = setInterval(() => visivel() && loadDetail().catch(console.error), 30000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [loadDetail, pollMsgs]);

  // Atualiza os tempos de espera a cada minuto, mesmo sem mensagens novas.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api<QuickReply[]>("/api/quick-replies").then(setQuickReplies).catch(console.error);
    api<{ departments: Department[] }>("/api/departments")
      .then((r) => setDepartments(r.departments.filter((d) => d.active)))
      .catch(console.error);
    // Link vindo do funil: /?c=<id da conversa>
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSelected(c);
  }, []);

  // Esc fecha a conversa aberta.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !newChat) setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  async function refresh() {
    await Promise.all([loadDetail(), loadList(), loadSummary()]);
  }

  async function setStatus(status: ConversationStatus) {
    if (!selected) return;
    await api(`/api/conversations/${selected}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await refresh();
  }

  // Direciona uma conversa para um atendente (arrastando para o nome dele) ou devolve para a fila (null).
  async function direcionar(convId: string, agentId: string | null) {
    await api(`/api/conversations/${convId}`, { method: "PATCH", body: JSON.stringify({ assign_to: agentId }) });
    await Promise.all([loadList(), loadSummary(), convId === selected ? loadDetail() : Promise.resolve()]);
  }
  const alvoDrop = (key: string, agentId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("text/conv")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropOn !== key) setDropOn(key);
    },
    onDragLeave: () => setDropOn((k) => (k === key ? "" : k)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropOn("");
      const id = e.dataTransfer.getData("text/conv");
      if (id) direcionar(id, agentId).catch((err) => alert(err.message));
    },
  });

  async function transfer(departmentId: string | null) {
    if (!selected) return;
    await api(`/api/conversations/${selected}`, { method: "PATCH", body: JSON.stringify({ department_id: departmentId }) });
    await refresh();
  }

  const extraFilters = (deptFilter ? 1 : 0) + (stage ? 1 : 0);
  const visiveis = (summary?.connections ?? []).filter((n) => !numOcultos.includes(n.id));
  const modoQuadros = quadros && !selected && !numero && visiveis.length > 1;

  return (
    <div className={`inbox inbox2${selected ? " tem-sel" : ""}${embed ? " embed" : ""}`}>
      {showFilters && (
        <aside className="ib-filters">
          <div className="ib-filters-head">
            <strong>Chat</strong>
            <button className="ib-icon-btn" title="Esconder filtros" onClick={() => setShowFilters(false)}>
              <Icon name="panel" />
            </button>
          </div>
          <nav className="ib-menu">
            {VIEWS.map((v) => (
              <button key={v.key} className={view === v.key ? "on" : ""} onClick={() => setView(v.key)}>
                <Icon name={v.icon} />
                <span>{v.label}</span>
                <span className="n">{v.key === "fechadas" ? "" : count(summary?.views[v.key])}</span>
              </button>
            ))}
          </nav>

          <Section title="CRM" open={crmOpen} onToggle={() => setCrmOpen(!crmOpen)}>
            {meInbox?.role === "admin" && (
              <button className="ib-crm-edit" onClick={() => setEditEtapas(true)} title="Criar, renomear, apagar e reordenar as etapas">
                ✏️ <span>{(summary?.etapas ?? []).length ? "Editar etapas" : "Criar etapas do CRM"}</span>
              </button>
            )}
            {(summary?.etapas ?? []).length === 0 && meInbox?.role !== "admin" && <span className="ib-dica">Nenhuma etapa criada.</span>}
            {(summary?.etapas ?? []).map((st) => (
              <button
                key={st.key}
                className={stage === st.key ? "on" : ""}
                onClick={() => setStage(stage === st.key ? "" : st.key)}
                title={stage === st.key ? "Clique de novo para tirar o filtro" : `Conversas de clientes em "${st.label}"`}
              >
                <span className="dot" style={{ background: st.color, width: 8, height: 8, marginRight: 4 }} />
                <span>{st.label}</span>
                <span className="n">{count(summary?.stages[st.key])}</span>
              </button>
            ))}
          </Section>

          {!!summary?.atendentes?.length && (
            <Section title="Atendentes" open={teamOpen} onToggle={() => setTeamOpen(!teamOpen)}>
              <span className="ib-dica">Arraste uma conversa para o nome do atendente para direcionar.</span>
              {summary.atendentes.map((a) => (
                <button
                  key={a.id}
                  className={`ib-agent${agentFilter === a.id ? " on" : ""}${dropOn === a.id ? " drop" : ""}`}
                  onClick={() => setAgentFilter(agentFilter === a.id ? "" : a.id)}
                  title={agentFilter === a.id ? "Clique de novo para tirar o filtro" : `Ver as conversas de ${a.name}`}
                  {...alvoDrop(a.id, a.id)}
                >
                  <Avatar id={a.id} name={a.name} size={22} />
                  <span>{a.name}{a.id === summary.me ? " (você)" : ""}</span>
                  <span className="n">{a.abertas || ""}</span>
                </button>
              ))}
              <button className={`ib-agent${dropOn === "__fila" ? " drop" : ""}`} title="Solte aqui para devolver a conversa para a fila" {...alvoDrop("__fila", null)}>
                <Icon name="hourglass" />
                <span>Devolver para a fila</span>
              </button>
            </Section>
          )}

          <Section title="Fila de atendimento" open={queueOpen} onToggle={() => setQueueOpen(!queueOpen)}>
            {QUEUES.map((q) => (
              <button key={q.key} className={queue === q.key ? "on" : ""} onClick={() => setQueue(q.key)}>
                <Icon name={q.icon} />
                <span>{q.label}</span>
                <span className="n">{count(summary?.queues[q.key])}</span>
              </button>
            ))}
          </Section>
        </aside>
      )}

      <aside className={`list${modoQuadros ? " list-quadros" : ""}`}>
        {(summary?.connections.length ?? 0) > 0 && (
          <div className="num-tabs" role="tablist" aria-label="Número de WhatsApp">
            <button className={`num-cfg${quadros ? " on" : ""}`} onClick={() => { setQuadros(!quadros); setQuadroAberto(null); }} title={quadros ? "Voltar para a lista" : "Ver os números em quadros"}>
              {quadros ? "☰ Lista" : "▦ Quadros"}
            </button>
            <button className="num-cfg" onClick={() => setNumCfg(!numCfg)} title="Escolher o que aparece aqui" aria-expanded={numCfg}>
              ⚙
            </button>
            {numMin ? (
              <button className="num-min" onClick={() => setNumMin(false)} title="Mostrar os números">
                {numero ? summary!.connections.find((n) => n.id === numero)?.name ?? "Números" : "Todos os números"} ▸
              </button>
            ) : (
              <button className={!numero ? "on" : ""} onClick={() => setNumero("")} title="Conversas de todos os números">
                Todos os números
              </button>
            )}
            {numCfg && (
              <div className="num-pop" onMouseLeave={() => setNumCfg(false)}>
                <b>Mostrar na tela principal</b>
                {summary!.connections.map((n) => (
                  <label key={n.id}>
                    <input
                      type="checkbox"
                      checked={!numOcultos.includes(n.id)}
                      onChange={(e) => setNumOcultos(e.target.checked ? numOcultos.filter((x) => x !== n.id) : [...numOcultos, n.id])}
                    />
                    <span className={`num-dot ${n.connected_at ? "ok" : "off"}`} /> {n.name}
                  </label>
                ))}
                <hr />
                <label>
                  <input type="checkbox" checked={numMin} onChange={(e) => setNumMin(e.target.checked)} /> Minimizar a barra de números
                </label>
                <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>As conversas dos números escondidos continuam em &quot;Todos os números&quot;.</p>
              </div>
            )}
            {!numMin && summary!.connections.filter((n) => !numOcultos.includes(n.id) || n.id === numero).map((n) => {
              const st = summary!.numeros?.[n.id];
              return (
                <button key={n.id} className={numero === n.id ? "on" : ""} onClick={() => setNumero(numero === n.id ? "" : n.id)} title={`${n.name}${n.phone ? " · " + formatPhone(n.phone) : ""}${n.connected_at ? " · conectado" : " · DESCONECTADO"}`}>
                  <span className={`num-dot ${n.connected_at ? "ok" : "off"}`} />
                  {n.name}
                  {st && <span className="num-n">{st.todas}</span>}
                  {st && st.pendentes > 0 && <span className="num-p" title="Aguardando resposta">{st.pendentes}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="ib-search">
          {!showFilters && (
            <button className="ib-icon-btn" title="Mostrar filtros" onClick={() => setShowFilters(true)}>
              <Icon name="panel" />
            </button>
          )}
          <label className="ib-search-box">
            <Icon name="search" size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar..." />
            {search && (
              <button className="ib-icon-btn" title="Limpar" onClick={() => setSearch("")}>
                <Icon name="close" size={14} />
              </button>
            )}
          </label>
          <div style={{ position: "relative" }}>
            <button
              className={`ib-icon-btn ${extraFilters ? "active" : ""}`}
              title="Filtrar por departamento"
              onClick={() => setFilterPop(!filterPop)}
            >
              <Icon name="filter" />
              {extraFilters > 0 && <span className="ib-pip">{extraFilters}</span>}
            </button>
            {filterPop && (
              <div className="ib-pop">
                <label>
                  Departamento
                  <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                    <option value="">Todos</option>
                    <option value="none">Sem departamento</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Etapa do CRM
                  <select value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">Todas</option>
                    {(summary?.etapas ?? []).map((st) => (
                      <option key={st.key} value={st.key}>{st.label}</option>
                    ))}
                  </select>
                </label>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <button
                    onClick={() => {
                      setDeptFilter("");
                      setStage("");
                    }}
                  >
                    Limpar
                  </button>
                  <button className="primary" onClick={() => setFilterPop(false)}>OK</button>
                </div>
              </div>
            )}
          </div>
          <button className="ib-icon-btn" title="Nova conversa" onClick={() => setNewChat(true)}>
            <Icon name="plus" />
          </button>
        </div>

        {(atrasadas > 0 || view === "atrasadas") && (
          <div className={`ib-alerta${view === "atrasadas" ? " on" : ""}`} role="alert">
            <span>
              ⚠ <b>{atrasadas}</b> {atrasadas === 1 ? "cliente esperando" : "clientes esperando"} resposta há mais de {lateMin} min
            </span>
            {view === "atrasadas" ? (
              <button onClick={() => setView("todas")}>Voltar para todas</button>
            ) : (
              <button className="primary" onClick={() => setView("atrasadas")}>Ver quem está esperando</button>
            )}
            {avisoPerm === "default" && (
              <button
                title="Mostra um aviso no computador quando um cliente passar do tempo de espera"
                onClick={() => Notification.requestPermission().then(setAvisoPerm).catch(() => {})}
              >
                🔔 Ativar avisos
              </button>
            )}
          </div>
        )}
        {view === "retomar" && (
          <div className="ib-dica-topo">
            Orçamentos e conversas em que <b>nós</b> mandamos a última mensagem e o cliente não responde há mais de {retomarDias}{" "}
            {retomarDias === 1 ? "dia" : "dias"} (até 30 dias). Abra a conversa e use <b>🔁 Escrever retomada</b>.
          </div>
        )}

        <div className="view-chips" role="tablist" aria-label="Situação">
          {VIEWS.map((v) => (
            <button key={v.key} className={view === v.key ? "on" : ""} onClick={() => setView(v.key)}>
              {v.label}
              {v.key !== "fechadas" && summary?.views[v.key] ? <span className="n">{count(summary.views[v.key])}</span> : null}
            </button>
          ))}
          {agentFilter && (
            <button className="on" onClick={() => setAgentFilter("")} title="Tirar o filtro de atendente">
              👤 {summary?.atendentes?.find((a) => a.id === agentFilter)?.name ?? "Atendente"} ×
            </button>
          )}
        </div>

        {modoQuadros ? (
          <div className={`quadros${quadroAberto ? " um" : ""}`}>
            {visiveis
              .filter((n) => !quadroAberto || n.id === quadroAberto)
              .map((n) => (
                <Quadro
                  key={n.id}
                  conn={n}
                  stats={summary?.numeros?.[n.id]}
                  params={params}
                  query={query}
                  aberto={quadroAberto === n.id}
                  onExpandir={() => setQuadroAberto(quadroAberto === n.id ? null : n.id)}
                  onAbrir={(id) => setSelected(id)}
                  me={summary?.me}
                  lateMin={lateMin}
                  retomar={view === "retomar"}
                />
              ))}
          </div>
        ) : (
        <div className="items">
          {list === null && <p className="muted" style={{ padding: 16 }}>Carregando...</p>}
          {list?.length === 0 && (
            <p className="muted" style={{ padding: 16 }}>{query ? `Nada encontrado para "${query}".` : "Nenhuma conversa aqui."}</p>
          )}
          {list?.map((c) => (
            <ConversationItem key={c.id} c={c} me={summary?.me} lateMin={lateMin} retomar={view === "retomar"} on={selected === c.id} onClick={() => setSelected(c.id)} arrastar={!!summary?.atendentes?.length} mostrarNumero={!numero && (summary?.connections.length ?? 0) > 1} />
          ))}
        </div>
        )}
      </aside>

      {detail ? (
        <>
          <Chat
            detail={detail}
            quickReplies={quickReplies}
            retomarDias={retomarDias}
            departments={departments}
            onStatus={setStatus}
            onTransfer={transfer}
            onSent={refresh}
            atendentes={summary?.atendentes ?? []}
            onAssign={(agentId) => direcionar(detail.conversation.id, agentId)}
            onBack={() => setSelected(null)}
            onToggleInfo={() => { setInfoOpen(!infoOpen); if (!infoOpen) setHistOpen(false); }}
            infoOpen={infoOpen}
            onToggleHist={() => { setHistOpen(!histOpen); if (!histOpen) setInfoOpen(false); }}
            histOpen={histOpen}
          />
          {histOpen && (
            <div className="side-wrap hp-wrap">
              <HistoricoPedidos
                contactId={detail.conversation.contact.id}
                contactName={detail.conversation.contact.name || ""}
                onClose={() => setHistOpen(false)}
              />
            </div>
          )}
          {infoOpen && !histOpen && (
            <div className="side-wrap">
              <button className="side-x" onClick={() => setInfoOpen(false)} aria-label="Fechar dados do cliente">×</button>
              <ContactSide detail={detail} onChange={loadDetail} />
            </div>
          )}
        </>
      ) : selected ? (
        <div className="empty">Carregando...</div>
      ) : modoQuadros ? null : (
        <div className="empty">
          <div className="ib-empty">
              <Icon name="chat" size={72} />
              <h2>Nenhuma conversa selecionada</h2>
              <p className="muted">Selecione uma conversa na lista para visualizar o atendimento.</p>
            </div>
        </div>
      )}

      {editEtapas && (
        <EtapasCrm
          etapas={summary?.etapas ?? []}
          onClose={() => setEditEtapas(false)}
          onSaved={(e) => { setSummary((s) => (s ? { ...s, etapas: e } : s)); setStage(""); }}
        />
      )}

      {newChat && (
        <NewChatModal
          connections={summary?.connections ?? []}
          onClose={() => setNewChat(false)}
          onCreated={async (id) => {
            setNewChat(false);
            setSelected(id);
            await Promise.all([loadList(), loadSummary()]);
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="ib-section">
      <button className="ib-section-head" onClick={onToggle}>
        {title}
        <span style={{ transform: open ? "rotate(180deg)" : undefined, display: "inline-flex" }}>
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open && <nav className="ib-menu">{children}</nav>}
    </div>
  );
}

function Avatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <span className="ib-avatar" style={{ background: avatarColor(id), width: size, height: size, fontSize: size * 0.36 }}>
      {initials(name)}
    </span>
  );
}

/** Um quadro da tela de conversas: as conversas de um número/canal, atualizando sozinho. */
function Quadro({
  conn,
  stats,
  params,
  query,
  aberto,
  onExpandir,
  onAbrir,
  me,
  lateMin,
  retomar,
}: {
  conn: { id: string; name: string; phone?: string | null; connected_at: string | null };
  stats?: NumStats;
  params: URLSearchParams;
  query: string;
  aberto: boolean;
  onExpandir: () => void;
  onAbrir: (id: string) => void;
  me?: string;
  lateMin: number;
  retomar: boolean;
}) {
  const [itens, setItens] = useState<ConvRow[] | null>(null);
  const chave = `${params.toString()}|${query}|${conn.id}`;
  useEffect(() => {
    let vivo = true;
    const carregar = () => {
      const p = new URLSearchParams(params);
      p.set("connection", conn.id);
      if (query) p.set("q", query);
      api<ConvRow[]>(`/api/conversations?${p}`)
        .then((d) => vivo && setItens(d))
        .catch(() => {});
    };
    setItens(null);
    carregar();
    const t = setInterval(carregar, 10000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return (
    <section className={`quadro${aberto ? " aberto" : ""}`}>
      <button className="quadro-head" onClick={onExpandir} title={aberto ? "Voltar aos quadros" : "Aumentar este quadro"}>
        <span className={`num-dot ${conn.connected_at ? "ok" : "off"}`} />
        <b>{conn.name}</b>
        {stats && <span className="num-n">{stats.todas}</span>}
        {stats && stats.pendentes > 0 && <span className="num-p" title="Aguardando resposta">{stats.pendentes}</span>}
        <span className="quadro-exp">{aberto ? "⤡ diminuir" : "⤢"}</span>
      </button>
      <div className="quadro-items">
        {itens === null && <p className="muted" style={{ padding: 12, margin: 0 }}>Carregando...</p>}
        {itens?.length === 0 && <p className="muted" style={{ padding: 12, margin: 0 }}>Nenhuma conversa aqui.</p>}
        {itens?.map((c) => (
          <ConversationItem key={c.id} c={c} me={me} lateMin={lateMin} retomar={retomar} on={false} onClick={() => onAbrir(c.id)} />
        ))}
      </div>
    </section>
  );
}

function ConversationItem({ c, me, on, onClick, arrastar, mostrarNumero, lateMin = LATE_MIN, retomar }: { c: ConvRow; me?: string; on: boolean; onClick: () => void; arrastar?: boolean; mostrarNumero?: boolean; lateMin?: number; retomar?: boolean }) {
  const name = c.contact.name || (c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone));
  const waiting = c.waiting_since && c.status !== "closed" && !c.contact.is_group ? c.waiting_since : null;
  const late = waiting && Date.now() - new Date(waiting).getTime() > lateMin * 60_000;
  return (
    <div
      className={`ib-item ${on ? "on" : ""} ${c.unread_count > 0 ? "has-unread" : ""}`}
      onClick={onClick}
      draggable={arrastar}
      onDragStart={arrastar ? (e) => { e.dataTransfer.setData("text/conv", c.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
      title={arrastar ? "Arraste para um atendente na barra lateral para direcionar" : undefined}
    >
      <Avatar id={c.contact.id} name={name} />
      <div className="ib-item-body">
        <div className="ib-line">
          <span className="name">{name}</span>
          <span className="time">{formatListTime(c.last_message_at)}</span>
          {c.unread_count > 0 && <span className="ib-unread">{c.unread_count > 99 ? "99+" : c.unread_count}</span>}
        </div>
        <div className="preview">{formatPreview(c.last_message_preview) || " "}</div>
        <div className="ib-line ib-tags">
          {mostrarNumero && c.connection ? (
            <span className="ib-num" title={`Chegou pelo número ${c.connection.name}`}>📱 {c.connection.name}</span>
          ) : null}
          {c.department ? (
            <span className="ib-dept">
              <span className="dot" style={{ background: c.department.color, width: 7, height: 7, marginRight: 4 }} />
              {c.department.name}
            </span>
          ) : (
            <span />
          )}
          <span className="ib-right">
            {retomar && (
              <span className="ib-chip ib-retomar" title="Tempo desde a nossa última mensagem, sem resposta do cliente">
                <Icon name="retry" size={12} /> sem resposta há {formatSince(c.last_message_at)}
              </span>
            )}
            {waiting && (
              <span className={`ib-wait ${late ? "late" : ""}`} title="Tempo esperando resposta">
                <Icon name="hourglass" size={12} />
                {formatSince(waiting)}
              </span>
            )}
            {c.status === "bot" && (
              <span className="ib-chip" title="A IA está atendendo">
                <Icon name="bot" size={12} /> Robô
              </span>
            )}
            {c.status === "closed" && <span className="ib-chip">Fechada</span>}
            {c.contact.is_group && (
              <span className="ib-chip" title="Grupo">
                <Icon name="users" size={13} />
              </span>
            )}
            {c.agent && (
              <span title={`Atendente: ${c.agent.name}${c.agent.id === me ? " (você)" : ""}`}>
                <Avatar id={c.agent.id} name={c.agent.name} size={22} />
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function NewChatModal({
  connections,
  onClose,
  onCreated,
}: {
  connections: Summary["connections"];
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [connectionId, setConnectionId] = useState(connections.find((c) => c.connected_at)?.id ?? connections[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ phone, name, connection_id: connectionId || null }),
      });
      if (message.trim()) {
        await api(`/api/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ body: message.trim() }) });
      }
      await onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao iniciar conversa");
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={start}>
        <h3 style={{ margin: 0 }}>Nova conversa</h3>
        <label>
          WhatsApp do cliente (com DDD)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-8888" autoFocus required />
        </label>
        <label>
          Nome (opcional)
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {connections.length > 1 && (
          <label>
            Enviar pelo número
            <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.connected_at ? "" : " (desconectado)"}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Primeira mensagem
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Olá! Aqui é da Sacolas Oficina..." />
        </label>
        {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy || !phone.trim()}>{busy ? "Abrindo..." : "Iniciar conversa"}</button>
        </div>
      </form>
    </div>
  );
}

function Chat({
  detail,
  quickReplies,
  retomarDias = RETOMAR_DIAS,
  departments,
  onStatus,
  onTransfer,
  onSent,
  atendentes = [],
  onAssign,
  onBack,
  onToggleInfo,
  infoOpen,
  onToggleHist,
  histOpen,
}: {
  detail: Detail;
  quickReplies: QuickReply[];
  retomarDias?: number;
  departments: Department[];
  onStatus: (s: ConversationStatus) => void;
  onTransfer: (departmentId: string | null) => void;
  onSent: () => Promise<void>;
  atendentes?: { id: string; name: string }[];
  onAssign?: (agentId: string | null) => Promise<void>;
  onBack?: () => void;
  onToggleInfo?: () => void;
  infoOpen?: boolean;
  onToggleHist?: () => void;
  histOpen?: boolean;
}) {
  const { conversation: c, messages } = detail;
  const me = useMe();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [qrIndex, setQrIndex] = useState(0);
  const [pdOpen, setPdOpen] = useState(false);
  const [acoes, setAcoes] = useState(false);
  // Painel de arquivos da conversa, busca dentro da conversa e foto ampliada na própria tela.
  const [arq, setArq] = useState(false);
  const [arqTab, setArqTab] = useState<"fotos" | "docs" | "audios" | "links">("fotos");
  const [busca, setBusca] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const arquivos = useMemo(() => {
    const out = { fotos: [] as Message[], docs: [] as Message[], audios: [] as Message[], links: [] as { url: string; m: Message }[] };
    for (const m of messages) {
      if (m.media_url && (m.media_type === "image" || m.media_type === "video" || m.media_type === "sticker")) out.fotos.push(m);
      else if (m.media_url && m.media_type === "audio") out.audios.push(m);
      else if (m.media_url && m.media_type) out.docs.push(m);
      for (const u of m.body?.match(/https?:\/\/[^\s]+/g) ?? []) out.links.push({ url: u, m });
    }
    return out;
  }, [messages]);
  useEffect(() => {
    if (!zoom) return;
    const f = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [zoom]);
  const qBusca = (busca ?? "").trim().toLowerCase();
  const achados = qBusca.length >= 2 ? messages.filter((m) => m.body?.toLowerCase().includes(qBusca)).length : 0;
  const [lula, setLula] = useState<{ open: boolean; busy: boolean; out: string; acao: string; q: string }>({ open: false, busy: false, out: "", acao: "", q: "" });
  async function perguntarLula(acao: "sugerir" | "resumir" | "perguntar" | "melhorar" | "followup" | "objecao") {
    setLula((l) => ({ ...l, busy: true, out: "", acao }));
    try {
      const r = await api<{ texto: string }>(`/api/conversations/${c.id}/lula`, { method: "POST", body: JSON.stringify({ acao, texto: acao === "melhorar" ? text : lula.q }) });
      setLula((l) => ({ ...l, busy: false, out: r.texto }));
    } catch (e) {
      setLula((l) => ({ ...l, busy: false, out: "⚠ " + (e as Error).message }));
    }
  }
  // Painel de histórico pode colocar um texto pronto na caixa de resposta.
  useEffect(() => {
    const h = (e: Event) => setText(String((e as CustomEvent).detail || ""));
    window.addEventListener("zap-rascunho", h);
    return () => window.removeEventListener("zap-rascunho", h);
  }, []);
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId, c.id]);

  // Respostas rápidas: digitar "/" no começo abre a lista.
  const qrMatches = useMemo(() => {
    if (!text.startsWith("/")) return [];
    const q = text.slice(1).toLowerCase();
    return quickReplies.filter((r) => r.shortcut.includes(q) || r.body.toLowerCase().includes(q)).slice(0, 8);
  }, [text, quickReplies]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      await api(`/api/conversations/${c.id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      setText("");
      await onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (qrMatches.length) {
      if (e.key === "ArrowDown") return (e.preventDefault(), setQrIndex((i) => (i + 1) % qrMatches.length));
      if (e.key === "ArrowUp") return (e.preventDefault(), setQrIndex((i) => (i - 1 + qrMatches.length) % qrMatches.length));
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        setText(qrMatches[Math.min(qrIndex, qrMatches.length - 1)].body);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <section className="chat">
      <header className="chat-head ch2">
        <div className="ch2-row">
          {onBack && (
            <button className="ch2-ic ch2-back" onClick={onBack} title="Voltar para a lista" aria-label="Voltar">←</button>
          )}
          <Avatar id={c.contact.id} name={c.contact.name || c.contact.phone} size={38} />
          <div className="who">
            <strong>{c.contact.name || (c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone))}</strong>
            <div className="muted ch2-meta">
              {c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone)}
              {c.connection && <> · 📱 {c.connection.name}</>}
              {" · "}<span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>
              {c.agent && <> · com {c.agent.name}</>}
              {c.department && <> · <span className="dept" style={{ background: c.department.color }}>{c.department.name}</span></>}
            </div>
          </div>
          {c.status !== "open" && c.status !== "closed" && (
            <button className="primary" onClick={() => onStatus("open")}>Assumir</button>
          )}
          <span className="pd-wrap">
            <button className="ch2-ic lula" onClick={() => setLula((l) => ({ ...l, open: !l.open }))} title="Lula, assistente de IA: sugere resposta, resume a conversa">🤖</button>
          {lula.open && (
            <span className="pd-menu lula-pop">
              <b className="lula-h">🤖 Lula · assistente de IA</b>
              <span className="lula-acts">
                {c.status !== "closed" && <button disabled={lula.busy} onClick={() => perguntarLula("sugerir")}>✍️ Sugerir resposta</button>}
                {c.status !== "closed" && <button disabled={lula.busy || !text.trim()} title={text.trim() ? "Deixa a mensagem que você escreveu mais clara e cordial, sem mudar valores e prazos" : "Escreva a mensagem na caixa de texto primeiro"} onClick={() => perguntarLula("melhorar")}>✨ Melhorar minha mensagem</button>}
                {c.status !== "closed" && <button disabled={lula.busy} title="Resposta para 'tá caro', 'vou pensar', 'já tenho fornecedor'..." onClick={() => perguntarLula("objecao")}>🛡 Responder objeção</button>}
                {c.status !== "closed" && <button disabled={lula.busy} title="Mensagem para retomar quando o cliente parou de responder" onClick={() => perguntarLula("followup")}>🔁 Retomar (follow-up)</button>}
                <button disabled={lula.busy} onClick={() => perguntarLula("resumir")}>📝 Resumir conversa</button>
              </span>
              <span className="lula-ask">
                <input
                  value={lula.q}
                  placeholder="Pergunte algo sobre esta conversa…"
                  onChange={(e) => setLula((l) => ({ ...l, q: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && lula.q.trim() && !lula.busy && perguntarLula("perguntar")}
                />
                <button disabled={lula.busy || !lula.q.trim()} onClick={() => perguntarLula("perguntar")}>Perguntar</button>
              </span>
              {lula.busy && <span className="muted">Lula está pensando…</span>}
              {lula.out && (
                <span className="lula-out">
                  {lula.out}
                  {["sugerir", "melhorar", "followup", "objecao"].includes(lula.acao) && !lula.out.startsWith("⚠") && (
                    <button className="primary" onClick={() => { setText(lula.out); setLula((l) => ({ ...l, open: false })); }}>
                      Usar na resposta
                    </button>
                  )}
                </span>
              )}
              <span className="pd-dica">O Lula nunca envia nada sozinho: você revisa e clica em Enviar.</span>
            </span>
          )}
          </span>
          {c.status !== "closed" && !c.contact.is_group && (
            <span className="pd-wrap">
              <button className="ch2-ic zap" onClick={() => setPdOpen((v) => !v)} title="Pedir dados de cadastro ao cliente">📝</button>
            {pdOpen && (
              <span className="pd-menu">
                <button onClick={() => { setText(msgCadastro("PJ")); setPdOpen(false); }}>
                  🏢 <b>Empresa</b><small>pede CNPJ e inscrição estadual</small>
                </button>
                <button onClick={() => { setText(msgCadastro("PF")); setPdOpen(false); }}>
                  👤 <b>Pessoa física</b><small>pede CPF e nascimento</small>
                </button>
                <span className="pd-dica">A mensagem vai para a caixa de texto: revise e clique em Enviar.</span>
              </span>
            )}
            </span>
          )}
          <span className="pd-wrap">
            <button className="ch2-ic" onClick={() => setAcoes((v) => !v)} title="Mais ações" aria-label="Mais ações">⋯</button>
            {acoes && (
              <span className="pd-menu ch2-acoes" onMouseLeave={() => setAcoes(false)}>
                {c.status !== "closed" && departments.length > 0 && (
                  <label>Transferir para departamento
                    <select value="" onChange={(e) => { setAcoes(false); if (e.target.value) onTransfer(e.target.value === "none" ? null : e.target.value); }}>
                      <option value="">Escolha…</option>
                      {departments.filter((d) => d.id !== c.department_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      {c.department_id && <option value="none">Sem departamento</option>}
                    </select>
                  </label>
                )}
                {c.status !== "closed" && atendentes.length > 0 && onAssign && (
                  <label>Direcionar para atendente
                    <select value="" onChange={(e) => { setAcoes(false); if (e.target.value) onAssign(e.target.value === "__fila" ? null : e.target.value).catch((err) => alert(err.message)); }}>
                      <option value="">Escolha…</option>
                      {atendentes.filter((a) => a.id !== c.assigned_to).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      {c.assigned_to && <option value="__fila">Devolver para a fila</option>}
                    </select>
                  </label>
                )}
                {me?.perms.tarefas && (
                  <button
                    onClick={async () => {
                      setAcoes(false);
                      const nomeCli = c.contact.name || (c.contact.is_group ? "grupo" : formatPhone(c.contact.phone));
                      const titulo = prompt("Tarefa ligada a esta conversa:", `Retornar para ${nomeCli}`);
                      if (!titulo?.trim()) return;
                      await api("/api/tarefas/cards", { method: "POST", body: JSON.stringify({ title: titulo, conversation_id: c.id, assignee: me?.id }) })
                        .then(() => alert("Tarefa criada em Tarefas (primeira coluna do quadro)."))
                        .catch((err) => alert(err.message));
                    }}
                  >📌 Criar tarefa desta conversa</button>
                )}
                {c.status !== "bot" && c.status !== "closed" && <button onClick={() => { setAcoes(false); onStatus("bot"); }}>🤖 Devolver para a IA</button>}
                {c.status !== "closed" && <button onClick={() => { setAcoes(false); onStatus("closed"); }}>✅ Encerrar conversa</button>}
                {c.status === "closed" && <button onClick={() => { setAcoes(false); onStatus("open"); }}>↩ Reabrir e assumir</button>}
                {me?.perms.apagar_historico && <button
          title="Apagar o histórico de mensagens desta conversa no OficinaZap"
          onClick={async () => {
            if (!confirm("Apagar TODO o histórico de mensagens desta conversa no OficinaZap?\n\nAs mensagens, fotos e arquivos somem daqui e não dá para recuperar. No celular as mensagens continuam. O contato, o orçamento e o funil ficam.")) return;
            if (!confirm("Tem certeza? Esta ação não pode ser desfeita.")) return;
            await api(`/api/conversations/${c.id}/history`, { method: "DELETE" });
            await onSent();
          }}
        >
          🗑 Apagar histórico
        </button>}
              </span>
            )}
          </span>
        </div>
        <nav className="ch2-tools" aria-label="Ferramentas da conversa">
          {onToggleHist && me?.perms.sistema_gestao && (
            <button className={`t-ped${histOpen ? " on" : ""}`} onClick={onToggleHist} title="Pedidos, orçamentos e ocorrências deste cliente no sistema de gestão">📦 Pedidos e orçamentos</button>
          )}
          {onToggleHist && me?.perms.sistema_gestao && (
            <button className={`t-oc${histOpen ? " on" : ""}`} onClick={onToggleHist} title="Ver e lançar ocorrências dos pedidos deste cliente">📋 Ocorrências</button>
          )}
          <button className={`t-arq${arq ? " on" : ""}`} onClick={() => setArq(!arq)} title="Fotos, documentos, áudios e links desta conversa">
            📎 Arquivos e fotos <b>{arquivos.fotos.length + arquivos.docs.length + arquivos.audios.length}</b>
          </button>
          {onToggleInfo && (
            <button className={`t-cli${infoOpen ? " on" : ""}`} onClick={onToggleInfo} title="Dados do cliente, funil e etiquetas">👤 Dados do cliente</button>
          )}
          {busca === null ? (
            <button className="t-bus" onClick={() => setBusca("")} title="Procurar uma palavra nesta conversa">🔍 Buscar na conversa</button>
          ) : (
            <span className="t-busca">
              <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar nesta conversa…" onKeyDown={(e) => e.key === "Escape" && setBusca(null)} />
              {qBusca.length >= 2 && <small>{achados} {achados === 1 ? "mensagem" : "mensagens"}</small>}
              <button onClick={() => setBusca(null)} aria-label="Fechar busca">×</button>
            </span>
          )}
        </nav>
      </header>

      <div className="chat-corpo">
      <div className={`msgs${qBusca.length >= 2 ? " buscando" : ""}`}>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const day = dayLabel(m.created_at);
          const newDay = !prev || dayLabel(prev.created_at) !== day;
          const sep = newDay && <div className="day-sep"><span>{day}</span></div>;
          if (m.sender === "system") {
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {sep}
                <div className="sysmsg">{m.body}</div>
              </div>
            );
          }
          // Mensagens seguidas do mesmo lado, com menos de 5 min entre elas, ficam juntas.
          const together =
            !newDay &&
            prev &&
            prev.sender !== "system" &&
            prev.direction === m.direction &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
          const mediaUrl = m.media_url && `/api/media?path=${encodeURIComponent(m.media_url)}`;
          const label = m.media_type && !mediaUrl ? MEDIA_TEXT[m.media_type] ?? `[${m.media_type}]` : null;
          // Corpo que é só "[image]" (sem o arquivo) vira o texto com ícone.
          const body = /^\[(image|audio|video|document|sticker)\]$/.test(m.body.trim()) ? "" : m.body;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {sep}
              <div className={`bubble ${m.direction === "in" ? "in" : m.sender} ${together ? "cont" : "first"}${qBusca.length >= 2 && m.body?.toLowerCase().includes(qBusca) ? " achou" : ""}`}>
                {m.media_type === "image" && mediaUrl ? (
                  <button type="button" className="media-btn" onClick={() => setZoom(mediaUrl)} title="Ampliar">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl} alt="imagem" className="media" loading="lazy" />
                  </button>
                ) : m.media_type === "audio" && mediaUrl ? (
                  <audio className="media-audio" controls preload="none" src={mediaUrl} />
                ) : m.media_type === "video" && mediaUrl ? (
                  <video className="media" controls preload="metadata" src={mediaUrl} />
                ) : m.media_type && mediaUrl ? (
                  <a className="media-link" href={mediaUrl} target="_blank" rel="noreferrer">
                    {MEDIA_TEXT[m.media_type] ?? "📎 Arquivo"} · abrir
                  </a>
                ) : (
                  label && <div className="media-ph">{label}</div>
                )}
                {body && (() => {
                  // Em grupo, "Nome: texto" vira o nome colorido em cima do texto.
                  const g = c.contact.is_group && m.direction === "in" ? body.match(/^([^:\n]{2,40}):\s([\s\S]*)$/) : null;
                  return g ? (
                    <>
                      <b className="g-nome" style={{ color: avatarColor(g[1]) }}>{g[1]}</b>
                      <Linkified text={g[2]} />
                    </>
                  ) : (
                    <Linkified text={body} />
                  );
                })()}
                {/* Espaço reservado no fim do texto para o horário (que fica no canto de baixo). */}
                <span className={`meta-sp ${m.sender === "bot" ? "wide" : ""}`} />
                <span className="meta">
                  {m.sender === "bot" ? "🤖 IA · " : ""}
                  {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {arq && (
        <aside className="arq-panel" aria-label="Arquivos da conversa">
          <div className="arq-h">
            <b>📎 Arquivos desta conversa</b>
            <button onClick={() => setArq(false)} aria-label="Fechar arquivos">×</button>
          </div>
          <div className="arq-tabs" role="tablist">
            {([["fotos", "🖼 Fotos e vídeos", arquivos.fotos.length], ["docs", "📄 Documentos", arquivos.docs.length], ["audios", "🎤 Áudios", arquivos.audios.length], ["links", "🔗 Links", arquivos.links.length]] as const).map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={arqTab === k} className={arqTab === k ? "on" : ""} onClick={() => setArqTab(k)}>{l} <small>{n}</small></button>
            ))}
          </div>
          <div className="arq-body">
            {arqTab === "fotos" && (arquivos.fotos.length ? (
              <div className="arq-grid">
                {arquivos.fotos.slice().reverse().map((m) => {
                  const u = `/api/media?path=${encodeURIComponent(m.media_url!)}`;
                  return m.media_type === "video" ? (
                    <a key={m.id} href={u} target="_blank" rel="noreferrer" className="arq-vid">🎬<small>{formatTime(m.created_at)}</small></a>
                  ) : (
                    <button key={m.id} type="button" onClick={() => setZoom(u)} title={new Date(m.created_at).toLocaleString("pt-BR")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" loading="lazy" />
                    </button>
                  );
                })}
              </div>
            ) : <p className="muted arq-vazio">Nenhuma foto nesta conversa.</p>)}
            {arqTab === "docs" && (arquivos.docs.length ? arquivos.docs.slice().reverse().map((m) => (
              <a key={m.id} className="arq-doc" href={`/api/media?path=${encodeURIComponent(m.media_url!)}`} target="_blank" rel="noreferrer">
                <span className="arq-ic">📄</span>
                <span><b>{m.body && !/^\[.*\]$/.test(m.body.trim()) ? m.body.slice(0, 60) : "Documento"}</b><small>{new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {m.direction === "in" ? "recebido" : "enviado"}</small></span>
                <span className="arq-abrir">Abrir ↗</span>
              </a>
            )) : <p className="muted arq-vazio">Nenhum documento nesta conversa.</p>)}
            {arqTab === "audios" && (arquivos.audios.length ? arquivos.audios.slice().reverse().map((m) => (
              <div key={m.id} className="arq-aud">
                <small>{new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {m.direction === "in" ? "cliente" : "nós"}</small>
                <audio controls preload="none" src={`/api/media?path=${encodeURIComponent(m.media_url!)}`} />
              </div>
            )) : <p className="muted arq-vazio">Nenhum áudio nesta conversa.</p>)}
            {arqTab === "links" && (arquivos.links.length ? arquivos.links.slice().reverse().map(({ url, m }, i) => (
              <a key={m.id + i} className="arq-doc" href={url} target="_blank" rel="noreferrer">
                <span className="arq-ic">🔗</span>
                <span><b>{url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50)}</b><small>{new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small></span>
              </a>
            )) : <p className="muted arq-vazio">Nenhum link nesta conversa.</p>)}
          </div>
        </aside>
      )}
      </div>
      {zoom && (
        <div className="zoom-bg" onClick={() => setZoom(null)} role="dialog" aria-label="Foto ampliada">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" onClick={(e) => e.stopPropagation()} />
          <span className="zoom-acts" onClick={(e) => e.stopPropagation()}>
            <a href={zoom} target="_blank" rel="noreferrer">Abrir em nova aba ↗</a>
            <a href={zoom} download>⬇ Baixar</a>
            <button onClick={() => setZoom(null)}>× Fechar</button>
          </span>
        </div>
      )}

      {c.status !== "closed" && !c.contact.is_group && c.last_from_me && Date.now() - new Date(c.last_message_at).getTime() > retomarDias * 864e5 && (
        <div className="retomar-bar">
          <span>🔁 O cliente não responde há {formatSince(c.last_message_at)} desde a nossa última mensagem.</span>
          <button
            className="primary"
            disabled={lula.busy}
            onClick={() => {
              setLula((l) => ({ ...l, open: true }));
              perguntarLula("followup");
            }}
          >
            {lula.busy && lula.acao === "followup" ? "Escrevendo…" : "Escrever retomada"}
          </button>
        </div>
      )}

      {c.status === "closed" ? (
        <div className="composer muted">Conversa encerrada. Se o cliente escrever de novo, uma nova conversa é aberta.</div>
      ) : (
        <div className="composer">
          {qrMatches.length > 0 && (
            <div className="qr-pop">
              {qrMatches.map((r, i) => (
                <div key={r.id} className={i === qrIndex ? "on" : ""} onMouseDown={() => setText(r.body)}>
                  <strong>/{r.shortcut}</strong> <span className="muted">{r.body.slice(0, 80)}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={text}
            placeholder={c.status === "bot" ? "A IA está atendendo. Se você responder, assume a conversa." : "Digite uma mensagem ou / para respostas rápidas"}
            onChange={(e) => {
              setText(e.target.value);
              setQrIndex(0);
            }}
            onKeyDown={onKey}
            rows={1}
          />
          <button className="primary" onClick={send} disabled={sending || !text.trim()}>
            Enviar
          </button>
          {error && <div style={{ color: "var(--danger)", position: "absolute", bottom: 2, left: 12, fontSize: 12 }}>{error}</div>}
        </div>
      )}
    </section>
  );
}

function ContactSide({ detail, onChange }: { detail: Detail; onChange: () => Promise<void> }) {
  const contact = detail.conversation.contact;
  const me = useMe();
  const [name, setName] = useState(contact.name ?? "");
  const [tags, setTags] = useState(contact.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [dealMsg, setDealMsg] = useState("");

  useEffect(() => {
    setName(contact.name ?? "");
    setTags(contact.tags.join(", "));
    setDealMsg("");
  }, [contact.id, contact.name, contact.tags]);

  async function save() {
    setSaving(true);
    await api(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, tags: tags.split(",") }),
    });
    setSaving(false);
    await onChange();
  }

  async function addToFunnel() {
    const q = detail.quote ?? {};
    const title = [q.quantidade, q.produto].filter(Boolean).join(" ") || contact.name || contact.phone;
    await api("/api/deals", {
      method: "POST",
      body: JSON.stringify({ contact_id: contact.id, conversation_id: detail.conversation.id, title: String(title) }),
    });
    setDealMsg("Adicionado ao funil em \"Novo lead\".");
  }

  const quote = Object.entries(detail.quote ?? {});
  return (
    <aside className="side">
      <h3 style={{ marginTop: 0 }}>Contato</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" />
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Etiquetas, separadas por vírgula" />
        <button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar contato"}</button>
      </div>

      {me?.perms.sistema_gestao && <GestaoBox detail={detail} onSent={onChange} />}

      <h3>Orçamento coletado</h3>
      {quote.length === 0 ? (
        <p className="muted">Nenhum dado ainda.</p>
      ) : (
        <dl>
          {quote.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k.replace(/_/g, " ")}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {me?.perms.funil && (
        <>
          <h3>Funil de vendas</h3>
          {dealMsg ? <p className="muted">{dealMsg}</p> : <button onClick={addToFunnel}>Adicionar ao funil</button>}
        </>
      )}
    </aside>
  );
}

type GPed = { numero: string; etapa: string; entrega: string | null; atrasado: boolean; total: number; aberto: number; itens: string | null; os: { numero: string; etapa: string }[] };
type GestaoResp = {
  ativo: boolean;
  site?: string;
  cliente?: { nome: string | null; fantasia: string | null; documento: string | null; cidade: string | null } | null;
  pedidos?: GPed[];
  aReceber?: number;
  creditos?: number;
  atualizadoEm?: string | null;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dBR = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "sem data");

/** Pedidos, etapas e saldo do cliente no sistema de gestão, ao lado da conversa. */
function GestaoBox({ detail, onSent }: { detail: Detail; onSent: () => Promise<void> }) {
  const contact = detail.conversation.contact;
  const [data, setData] = useState<GestaoResp | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [enviando, setEnviando] = useState("");

  useEffect(() => {
    if (contact.is_group) return;
    let vivo = true;
    setData(null);
    api<GestaoResp>(`/api/gestao?telefone=${encodeURIComponent(contact.phone)}`)
      .then((r) => vivo && setData(r))
      .catch(() => vivo && setData({ ativo: false }));
    return () => {
      vivo = false;
    };
  }, [contact.id, contact.phone, contact.is_group]);

  if (contact.is_group) return null;
  if (!data) return (<><h3>📦 Sistema de gestão</h3><p className="muted">Consultando…</p></>);
  if (!data.ativo) return null;

  const pedidos = data.pedidos ?? [];
  const ativos = pedidos.filter((p) => p.etapa !== "Concluído");
  const lista = verTodos ? pedidos : ativos;

  async function enviarStatus(p: GPed) {
    const nome = data?.cliente?.fantasia || data?.cliente?.nome || "";
    const prod = p.os.length ? p.os.map((o) => o.etapa).join(", ") : p.etapa;
    const texto = `Olá${nome ? ", " + nome : ""}! Atualização do seu pedido nº ${p.numero}: está na etapa *${prod}*. Previsão de entrega: ${dBR(p.entrega)}. Qualquer dúvida, estou à disposição.`;
    setEnviando(p.numero);
    try {
      await api(`/api/conversations/${detail.conversation.id}/messages`, { method: "POST", body: JSON.stringify({ body: texto }) });
      await onSent();
    } finally {
      setEnviando("");
    }
  }

  return (
    <div className="gz">
      <h3>📦 Sistema de gestão</h3>
      {data.cliente ? (
        <p className="gz-cli"><b>{data.cliente.fantasia || data.cliente.nome}</b>{data.cliente.cidade ? ` · ${data.cliente.cidade}` : ""}</p>
      ) : (
        <p className="muted">Telefone não encontrado no cadastro de clientes do sistema.</p>
      )}
      {(data.aReceber ?? 0) > 0.009 && <p className="gz-deb">Saldo em aberto: <b>{brl(data.aReceber!)}</b></p>}
      {(data.creditos ?? 0) > 0.009 && <p className="gz-cred">Crédito do cliente: <b>{brl(data.creditos!)}</b></p>}
      {data.cliente && (
        <>
          <p className="muted" style={{ margin: "6px 0" }}>{ativos.length} pedido{ativos.length === 1 ? "" : "s"} em andamento</p>
          {lista.map((p) => (
            <div key={p.numero} className={`gz-ped${p.atrasado ? " late" : ""}`}>
              <div className="gz-h"><b>Pedido {p.numero}</b>{p.atrasado && <span className="gz-tag">atrasado</span>}</div>
              <div className="gz-et">{p.etapa}{p.os.length ? ` · produção: ${p.os.map((o) => o.etapa).join(", ")}` : ""}</div>
              <div className="muted gz-sm">Entrega {dBR(p.entrega)}{p.aberto > 0.009 ? ` · falta receber ${brl(p.aberto)}` : ""}</div>
              {p.itens && <div className="muted gz-sm gz-it">{p.itens}</div>}
              {p.etapa !== "Concluído" && (
                <button className="gz-btn" disabled={!!enviando} onClick={() => enviarStatus(p)}>
                  {enviando === p.numero ? "Enviando…" : "💬 Enviar status ao cliente"}
                </button>
              )}
            </div>
          ))}
          {pedidos.length > ativos.length && (
            <button className="gz-link" onClick={() => setVerTodos(!verTodos)}>{verTodos ? "Só em andamento" : "Ver também os concluídos"}</button>
          )}
        </>
      )}
      {data.site && <a className="gz-link" href={data.site} target="_blank" rel="noopener">Abrir o sistema de gestão ↗</a>}
      {data.atualizadoEm && <p className="muted gz-sm">Dados de {new Date(data.atualizadoEm).toLocaleString("pt-BR").slice(0, 16)}</p>}
    </div>
  );
}

const MEDIA_TEXT: Record<string, string> = {
  image: "📷 Imagem",
  audio: "🎤 Áudio",
  video: "🎬 Vídeo",
  document: "📄 Documento",
  sticker: "🏷️ Figurinha",
};

/** "Hoje", "Ontem", dia da semana (última semana) ou a data. */
function dayLabel(iso: string) {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) return d.toLocaleDateString("pt-BR", { weekday: "long" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Texto da mensagem com os links clicáveis (link comprido aparece encurtado). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <span className="txt">
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return part;
        const short = part.replace(/^https?:\/\/(www\.)?/, "");
        return (
          <a key={i} href={part} target="_blank" rel="noreferrer" title={part}>
            {short.length > 48 ? `${short.slice(0, 45)}…` : short}
          </a>
        );
      })}
    </span>
  );
}
