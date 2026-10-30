"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
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
import { STAGES } from "@/lib/stages";

type DeptTag = Pick<Department, "id" | "name" | "color">;
type ConvRow = Conversation & {
  contact: Contact;
  department: DeptTag | null;
  agent: { id: string; name: string } | null;
};
type Detail = { conversation: ConvRow; messages: Message[]; quote: QuoteData | null };
type QuickReply = { id: string; shortcut: string; body: string };
type Summary = {
  views: Record<string, number>;
  queues: Record<string, number>;
  stages: Record<string, number>;
  connections: { id: string; name: string; connected_at: string | null }[];
  me: string;
};

const VIEWS = [
  { key: "todas", label: "Todas", icon: "chat" },
  { key: "minhas", label: "Minhas", icon: "user" },
  { key: "pendentes", label: "Pendentes", icon: "hourglass" },
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

const STAGE_COLORS: Record<string, string> = {
  novo: "#6b7280",
  orcamento: "#2b6cb0",
  arte: "#6b46c1",
  fechado: "#128c4a",
  producao: "#2c7a7b",
  entregue: "#38a169",
  perdido: "#c53030",
};

const POLL_MS = 3000;
const SUMMARY_MS = 10000;
/** Acima disso o tempo de espera fica vermelho. */
const LATE_MIN = 60;

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
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = usePref("sidebar", true);
  const [crmOpen, setCrmOpen] = usePref("crmOpen", true);
  const [queueOpen, setQueueOpen] = usePref("queueOpen", true);
  const [filterPop, setFilterPop] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [list, setList] = useState<ConvRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
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
    return p;
  }, [view, queue, stage, deptFilter]);

  const loadList = useCallback(async () => {
    const p = new URLSearchParams(params);
    if (query) p.set("q", query);
    setList(await api<ConvRow[]>(`/api/conversations?${p}`));
  }, [params, query]);

  const loadSummary = useCallback(async () => {
    setSummary(await api<Summary>(`/api/conversations/summary?${params}`));
  }, [params]);

  const loadDetail = useCallback(async () => {
    if (selected) setDetail(await api<Detail>(`/api/conversations/${selected}`));
  }, [selected]);

  useEffect(() => {
    loadList().catch(console.error);
    const t = setInterval(() => loadList().catch(console.error), POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    loadSummary().catch(console.error);
    const t = setInterval(() => loadSummary().catch(console.error), SUMMARY_MS);
    return () => clearInterval(t);
  }, [loadSummary]);

  useEffect(() => {
    setDetail(null);
    loadDetail().catch(console.error);
    const t = setInterval(() => loadDetail().catch(console.error), POLL_MS);
    return () => clearInterval(t);
  }, [loadDetail]);

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

  async function transfer(departmentId: string | null) {
    if (!selected) return;
    await api(`/api/conversations/${selected}`, { method: "PATCH", body: JSON.stringify({ department_id: departmentId }) });
    await refresh();
  }

  const extraFilters = (deptFilter ? 1 : 0) + (stage ? 1 : 0);

  return (
    <div className="inbox">
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
            {STAGES.map((st) => (
              <button
                key={st.key}
                className={stage === st.key ? "on" : ""}
                onClick={() => setStage(stage === st.key ? "" : st.key)}
                title={stage === st.key ? "Clique de novo para tirar o filtro" : `Conversas de clientes em "${st.label}"`}
              >
                <span className="dot" style={{ background: STAGE_COLORS[st.key], width: 8, height: 8, marginRight: 4 }} />
                <span>{st.label}</span>
                <span className="n">{count(summary?.stages[st.key])}</span>
              </button>
            ))}
          </Section>

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

      <aside className="list">
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
                    {STAGES.map((st) => (
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

        <div className="items">
          {list === null && <p className="muted" style={{ padding: 16 }}>Carregando...</p>}
          {list?.length === 0 && (
            <p className="muted" style={{ padding: 16 }}>{query ? `Nada encontrado para "${query}".` : "Nenhuma conversa aqui."}</p>
          )}
          {list?.map((c) => (
            <ConversationItem key={c.id} c={c} me={summary?.me} on={selected === c.id} onClick={() => setSelected(c.id)} />
          ))}
        </div>
      </aside>

      {detail ? (
        <>
          <Chat
            detail={detail}
            quickReplies={quickReplies}
            departments={departments}
            onStatus={setStatus}
            onTransfer={transfer}
            onSent={refresh}
          />
          <ContactSide detail={detail} onChange={loadDetail} />
        </>
      ) : selected ? (
        <div className="empty">Carregando...</div>
      ) : (
        <div className="empty">
          <div className="ib-empty">
            <Icon name="chat" size={72} />
            <h2>Nenhuma conversa selecionada</h2>
            <p className="muted">Selecione uma conversa na lista para visualizar o atendimento.</p>
          </div>
        </div>
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

function ConversationItem({ c, me, on, onClick }: { c: ConvRow; me?: string; on: boolean; onClick: () => void }) {
  const name = c.contact.name || (c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone));
  const waiting = c.waiting_since && c.status !== "closed" && !c.contact.is_group ? c.waiting_since : null;
  const late = waiting && Date.now() - new Date(waiting).getTime() > LATE_MIN * 60_000;
  return (
    <div className={`ib-item ${on ? "on" : ""} ${c.unread_count > 0 ? "has-unread" : ""}`} onClick={onClick}>
      <Avatar id={c.contact.id} name={name} />
      <div className="ib-item-body">
        <div className="ib-line">
          <span className="name">{name}</span>
          <span className="time">{formatListTime(c.last_message_at)}</span>
          {c.unread_count > 0 && <span className="ib-unread">{c.unread_count > 99 ? "99+" : c.unread_count}</span>}
        </div>
        <div className="preview">{formatPreview(c.last_message_preview) || " "}</div>
        <div className="ib-line ib-tags">
          {c.department ? (
            <span className="ib-dept">
              <span className="dot" style={{ background: c.department.color, width: 7, height: 7, marginRight: 4 }} />
              {c.department.name}
            </span>
          ) : (
            <span />
          )}
          <span className="ib-right">
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
  departments,
  onStatus,
  onTransfer,
  onSent,
}: {
  detail: Detail;
  quickReplies: QuickReply[];
  departments: Department[];
  onStatus: (s: ConversationStatus) => void;
  onTransfer: (departmentId: string | null) => void;
  onSent: () => Promise<void>;
}) {
  const { conversation: c, messages } = detail;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [qrIndex, setQrIndex] = useState(0);
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
      <header className="chat-head">
        <div className="who">
          <strong>{c.contact.name || (c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone))}</strong>
          <div className="muted">
            {c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone)} ·{" "}
            <span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>
            {c.agent && <> · com {c.agent.name}</>}
            {c.department && (
              <>
                {" "}· <span className="dept" style={{ background: c.department.color }}>{c.department.name}</span>
              </>
            )}
          </div>
        </div>
        {c.status !== "closed" && departments.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && onTransfer(e.target.value === "none" ? null : e.target.value)}
            style={{ width: "auto" }}
            title="Transferir para outro departamento"
          >
            <option value="">Transferir para...</option>
            {departments
              .filter((d) => d.id !== c.department_id)
              .map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            {c.department_id && <option value="none">Sem departamento</option>}
          </select>
        )}
        {c.status !== "open" && c.status !== "closed" && (
          <button className="primary" onClick={() => onStatus("open")}>Assumir</button>
        )}
        {c.status !== "bot" && c.status !== "closed" && (
          <button onClick={() => onStatus("bot")}>Devolver para IA</button>
        )}
        {c.status !== "closed" && <button onClick={() => onStatus("closed")}>Encerrar</button>}
      </header>

      <div className="msgs">
        {messages.map((m) =>
          m.sender === "system" ? (
            <div key={m.id} className="sysmsg">{m.body}</div>
          ) : (
            <div key={m.id} className={`bubble ${m.direction === "in" ? "in" : m.sender}`}>
              {m.media_type === "image" && m.media_url ? (
                <a href={`/api/media?path=${encodeURIComponent(m.media_url)}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media?path=${encodeURIComponent(m.media_url)}`} alt="imagem do cliente" className="media" />
                </a>
              ) : m.media_type && m.media_url ? (
                <a href={`/api/media?path=${encodeURIComponent(m.media_url)}`} target="_blank" rel="noreferrer">
                  📎 abrir {m.media_type}
                </a>
              ) : (
                m.media_type && <div className="muted">[{m.media_type}]</div>
              )}
              {m.body}
              <div className="meta">
                {m.sender === "bot" ? "🤖 IA · " : ""}
                {formatTime(m.created_at)}
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

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

      <GestaoBox detail={detail} onSent={onChange} />

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

      <h3>Funil de vendas</h3>
      {dealMsg ? <p className="muted">{dealMsg}</p> : <button onClick={addToFunnel}>Adicionar ao funil</button>}
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
