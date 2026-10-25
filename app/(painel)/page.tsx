"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatPhone, formatTime, STATUS_LABEL } from "@/lib/client";
import type { Contact, Conversation, ConversationStatus, Message, QuoteData } from "@/lib/db";

type ConvRow = Conversation & { contact: Contact };
type Detail = { conversation: ConvRow; messages: Message[]; quote: QuoteData | null };
type QuickReply = { id: string; shortcut: string; body: string };

const FILTERS: { key: string; label: string }[] = [
  { key: "active", label: "Ativas" },
  { key: "waiting", label: "Aguardando" },
  { key: "open", label: "Em atendimento" },
  { key: "bot", label: "IA" },
  { key: "closed", label: "Encerradas" },
];

const POLL_MS = 3000;

export default function InboxPage() {
  const [filter, setFilter] = useState("active");
  const [list, setList] = useState<ConvRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);

  const loadList = useCallback(async () => {
    setList(await api<ConvRow[]>(`/api/conversations?status=${filter}`));
  }, [filter]);

  const loadDetail = useCallback(async () => {
    if (selected) setDetail(await api<Detail>(`/api/conversations/${selected}`));
  }, [selected]);

  useEffect(() => {
    loadList().catch(console.error);
    const t = setInterval(() => loadList().catch(console.error), POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    setDetail(null);
    loadDetail().catch(console.error);
    const t = setInterval(() => loadDetail().catch(console.error), POLL_MS);
    return () => clearInterval(t);
  }, [loadDetail]);

  useEffect(() => {
    api<QuickReply[]>("/api/quick-replies").then(setQuickReplies).catch(console.error);
    // Link vindo do funil: /?c=<id da conversa>
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) setSelected(c);
  }, []);

  async function setStatus(status: ConversationStatus) {
    if (!selected) return;
    await api(`/api/conversations/${selected}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await Promise.all([loadDetail(), loadList()]);
  }

  return (
    <div className="inbox">
      <aside className="list">
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="items">
          {list.length === 0 && <p className="muted" style={{ padding: 16 }}>Nenhuma conversa aqui.</p>}
          {list.map((c) => (
            <div key={c.id} className={`item ${selected === c.id ? "on" : ""}`} onClick={() => setSelected(c.id)}>
              <span className="name">
                {c.contact.name || formatPhone(c.contact.phone)}
                {c.unread_count > 0 && <span className="unread">{c.unread_count}</span>}
              </span>
              <span className="time">{formatTime(c.last_message_at)}</span>
              <span className="preview">{c.last_message_preview}</span>
              <span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>
            </div>
          ))}
        </div>
      </aside>

      {detail ? (
        <>
          <Chat detail={detail} quickReplies={quickReplies} onStatus={setStatus} onSent={loadDetail} />
          <ContactSide detail={detail} onChange={loadDetail} />
        </>
      ) : (
        <div className="empty">{selected ? "Carregando..." : "Escolha uma conversa"}</div>
      )}
    </div>
  );
}

function Chat({
  detail,
  quickReplies,
  onStatus,
  onSent,
}: {
  detail: Detail;
  quickReplies: QuickReply[];
  onStatus: (s: ConversationStatus) => void;
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
          <strong>{c.contact.name || formatPhone(c.contact.phone)}</strong>
          <div className="muted">
            {formatPhone(c.contact.phone)} · <span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>
          </div>
        </div>
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
