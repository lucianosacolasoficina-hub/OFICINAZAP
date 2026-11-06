"use client";

// Peças da caixa de conversa com as funções do WhatsApp Business, num visual próprio do OficinaZap:
// emojis, gravação de áudio, texto com *negrito* / _itálico_ / ~riscado~, encaminhar, etiquetas e catálogo.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, avatarColor, formatPhone } from "@/lib/client";
import type { Contact, Message } from "@/lib/db";

/* ---------------------------------- Emojis ---------------------------------- */

const EMOJIS: { k: string; l: string; e: string[] }[] = [
  { k: "rostos", l: "😀", e: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠".split(" ") },
  { k: "gestos", l: "👍", e: "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫶 👀 🧠 🙋 🙋‍♂️ 🙋‍♀️ 🤷 🤷‍♂️ 🤷‍♀️ 🙇 💁 🙆 🙅".split(" ") },
  { k: "coracao", l: "❤️", e: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✨ ⭐ 🌟 🔥 💯 🎉 🎊 🎁 🏆 🥇 👑".split(" ") },
  { k: "negocio", l: "🛍️", e: "🛍️ 🛒 📦 📫 🚚 🚛 🏭 🏪 🏬 💰 💵 💳 🧾 💲 📈 📉 📊 📋 📌 📎 🖨️ ✂️ 📏 📐 🎨 🖌️ 🏷️ 🔖 📝 ✏️ 📅 📆 ⏰ ⏳ ⌛ 📞 📱 💻 📧 ✉️ 📄 📃 📑 🗂️ 🔍 🔒 🔑 ⚙️ 🧰".split(" ") },
  { k: "simbolos", l: "✅", e: "✅ ☑️ ✔️ ❌ ❎ ⚠️ 🚫 ⛔ ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 ➡️ ⬅️ ⬆️ ⬇️ ↩️ 🔁 🔄 🆕 🆗 🆓 🔝 🔜 ℹ️ #️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣".split(" ") },
  { k: "natureza", l: "🌻", e: "🌻 🌹 🌷 🌸 🌼 🍀 🌿 🌳 🌴 🌵 ☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌈 ❄️ 🌊 🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦋 🐝 ☕ 🍕 🍔 🍟 🌭 🍰 🎂 🍫 🍺 🥂 🍾".split(" ") },
];
const RECENTES = "oz.emojisRecentes";
function lerRecentes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTES) || "[]");
    return Array.isArray(v) ? v.slice(0, 24) : [];
  } catch {
    return [];
  }
}
function guardarRecente(e: string) {
  try {
    localStorage.setItem(RECENTES, JSON.stringify([e, ...lerRecentes().filter((x) => x !== e)].slice(0, 24)));
  } catch {}
}

/** Painel de emojis (com os usados por último primeiro). */
export function EmojiPicker({ onPick, onClose, className = "" }: { onPick: (e: string) => void; onClose: () => void; className?: string }) {
  const [recentes, setRecentes] = useState<string[]>([]);
  const [aba, setAba] = useState("rostos");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = lerRecentes();
    setRecentes(r);
    if (r.length) setAba("recentes");
  }, []);
  useEffect(() => {
    const fora = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    const t = setTimeout(() => window.addEventListener("mousedown", fora), 0);
    window.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", fora);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const lista = aba === "recentes" ? recentes : EMOJIS.find((c) => c.k === aba)?.e ?? [];
  return (
    <div ref={ref} className={`zx-emoji ${className}`} role="dialog" aria-label="Emojis" onClick={(e) => e.stopPropagation()}>
      <div className="zx-emoji-abas" role="tablist">
        {recentes.length > 0 && (
          <button type="button" role="tab" aria-selected={aba === "recentes"} className={aba === "recentes" ? "on" : ""} onClick={() => setAba("recentes")} title="Usados por último">
            🕘
          </button>
        )}
        {EMOJIS.map((c) => (
          <button type="button" role="tab" key={c.k} aria-selected={aba === c.k} className={aba === c.k ? "on" : ""} onClick={() => setAba(c.k)}>
            {c.l}
          </button>
        ))}
      </div>
      <div className="zx-emoji-grade">
        {lista.map((e) => (
          <button
            type="button"
            key={e}
            onClick={() => {
              guardarRecente(e);
              onPick(e);
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Gravar áudio ------------------------------ */

/** Grava a voz pelo microfone do computador ou celular. */
export function useGravador() {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const fim = useRef<((b: Blob | null) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const limpar = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setGravando(false);
    setSegundos(0);
  }, []);
  useEffect(() => () => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    limpar();
  }, [limpar]);

  const iniciar = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Este navegador não grava áudio. Use o Chrome ou o Edge atualizados.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
      throw new Error("O navegador não liberou o microfone. Clique no cadeado ao lado do endereço do site e permita o microfone.");
    });
    const tipo = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
    partes.current = [];
    r.ondataavailable = (e) => e.data.size && partes.current.push(e.data);
    r.onstop = () => {
      const b = partes.current.length ? new Blob(partes.current, { type: (r.mimeType || tipo || "audio/webm").split(";")[0] }) : null;
      fim.current?.(b);
      fim.current = null;
    };
    r.start(250);
    rec.current = r;
    setGravando(true);
    setSegundos(0);
    const ini = Date.now();
    timer.current = setInterval(() => setSegundos(Math.floor((Date.now() - ini) / 1000)), 250);
  }, []);

  /** Para e devolve o áudio gravado (ou null se cancelar). */
  const parar = useCallback(
    (cancelar = false) =>
      new Promise<Blob | null>((ok) => {
        const r = rec.current;
        if (!r || r.state === "inactive") {
          limpar();
          return ok(null);
        }
        fim.current = (b) => ok(cancelar ? null : b);
        r.stop();
        limpar();
      }),
    [limpar],
  );
  return { gravando, segundos, iniciar, parar };
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ------------------------- Texto com formatação ------------------------- */

const FORMATO = /(```[\s\S]+?```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
function formatar(t: string, base: number) {
  return t.split(FORMATO).map((p, i) => {
    const k = base + i;
    if (p.length > 6 && p.startsWith("```") && p.endsWith("```")) return <code key={k} className="zx-mono">{p.slice(3, -3)}</code>;
    if (p.length > 2 && p[0] === "*" && p.endsWith("*") && p[1] !== " ") return <b key={k}>{p.slice(1, -1)}</b>;
    if (p.length > 2 && p[0] === "_" && p.endsWith("_") && p[1] !== " ") return <i key={k}>{p.slice(1, -1)}</i>;
    if (p.length > 2 && p[0] === "~" && p.endsWith("~") && p[1] !== " ") return <s key={k}>{p.slice(1, -1)}</s>;
    return p;
  });
}

/** Texto da mensagem: links clicáveis e *negrito*, _itálico_, ~riscado~ e ```monoespaçado``` como no WhatsApp. */
export function TextoZap({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <span className="txt">
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{formatar(part, i * 1000)}</span>;
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

/** Ctrl+B / Ctrl+I / Ctrl+Shift+X: põe a marca de negrito/itálico/riscado em volta do texto selecionado. */
export function atalhoFormato(e: React.KeyboardEvent<HTMLTextAreaElement>, setText: (t: string) => void) {
  if (!(e.ctrlKey || e.metaKey)) return false;
  const k = e.key.toLowerCase();
  const marca = k === "b" ? "*" : k === "i" ? "_" : k === "x" && e.shiftKey ? "~" : k === "m" && e.shiftKey ? "```" : null;
  if (!marca) return false;
  e.preventDefault();
  envolver(e.currentTarget, marca, setText);
  return true;
}
export function envolver(el: HTMLTextAreaElement, marca: string, setText: (t: string) => void) {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const meio = value.slice(a, b) || "texto";
  setText(value.slice(0, a) + marca + meio + marca + value.slice(b));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(a + marca.length, a + marca.length + meio.length);
  });
}

/* ------------------------------- Etiquetas ------------------------------- */

/** Etiquetas sugeridas (as mesmas ideias do WhatsApp Business, para o dia a dia de pedidos). */
export const ETIQUETAS_PADRAO = ["novo cliente", "orçamento enviado", "novo pedido", "pagamento pendente", "pago", "em produção", "pedido finalizado"];

export function corEtiqueta(t: string) {
  const fixas: Record<string, string> = {
    "novo cliente": "#0ea5e9",
    "orçamento enviado": "#a855f7",
    "novo pedido": "#f59e0b",
    "pagamento pendente": "#ef4444",
    pago: "#16a34a",
    "em produção": "#6366f1",
    "pedido finalizado": "#64748b",
  };
  return fixas[t] ?? avatarColor(t);
}

export function ChipsEtiquetas({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (!tags?.length) return null;
  return (
    <span className="zx-tags">
      {tags.slice(0, max).map((t) => (
        <span key={t} className="zx-tag" style={{ ["--c" as string]: corEtiqueta(t) }} title={`Etiqueta: ${t}`}>
          {t}
        </span>
      ))}
      {tags.length > max && <span className="zx-tag mais">+{tags.length - max}</span>}
    </span>
  );
}

/** Escolher as etiquetas do cliente direto da conversa. */
export function EtiquetasPop({ contact, onSaved, onClose }: { contact: Contact; onSaved: () => void; onClose: () => void }) {
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const opcoes = [...new Set([...ETIQUETAS_PADRAO, ...(contact.tags ?? [])])];
  async function salvar(lista: string[]) {
    setTags(lista);
    setSalvando(true);
    setErro("");
    try {
      await api(`/api/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ tags: lista }) });
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar");
      setTags(contact.tags ?? []);
    } finally {
      setSalvando(false);
    }
  }
  return (
    <span className="pd-menu zx-etq" onClick={(e) => e.stopPropagation()}>
      <b className="zx-h">🏷 Etiquetas do cliente <button type="button" onClick={onClose} aria-label="Fechar">×</button></b>
      {opcoes.map((t) => {
        const on = tags.includes(t);
        return (
          <label key={t} className={`zx-etq-op${on ? " on" : ""}`} style={{ ["--c" as string]: corEtiqueta(t) }}>
            <input type="checkbox" checked={on} disabled={salvando} onChange={() => salvar(on ? tags.filter((x) => x !== t) : [...tags, t])} />
            <span className="zx-bola" />
            {t}
          </label>
        );
      })}
      <form
        className="zx-etq-nova"
        onSubmit={(e) => {
          e.preventDefault();
          const t = nova.trim().toLowerCase();
          if (!t || tags.includes(t)) return;
          setNova("");
          salvar([...tags, t]);
        }}
      >
        <input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova etiqueta…" maxLength={30} />
        <button type="submit" disabled={!nova.trim() || salvando}>Criar</button>
      </form>
      {erro && <span className="zx-erro">{erro}</span>}
      <span className="pd-dica">As etiquetas aparecem na lista de conversas e ajudam a achar os clientes.</span>
    </span>
  );
}

/* ------------------------------- Encaminhar ------------------------------- */

type ConvBusca = { id: string; contact: Contact; connection?: { name: string } | null; last_message_at: string };
/** A mesma mensagem para muitos contatos é o que o WhatsApp pune: encaminha para no máximo 4 conversas por vez. */
const MAX_ENCAMINHAR = 4;

export function EncaminharModal({ msg, resumo, atual, onClose, onDone }: { msg: Message; resumo: string; atual: string; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ConvBusca[] | null>(null);
  const [escolhidas, setEscolhidas] = useState<ConvBusca[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [res, setRes] = useState<{ nome: string; ok: boolean; erro?: string }[] | null>(null);
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      const p = new URLSearchParams({ view: "todas", queue: "todas" });
      if (q.trim()) p.set("q", q.trim());
      api<ConvBusca[]>(`/api/conversations?${p}`)
        .then((d) => vivo && setLista(d.filter((c) => c.id !== atual).slice(0, 40)))
        .catch(() => vivo && setLista([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [q, atual]);
  const nome = (c: ConvBusca) => c.contact.name || (c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone));
  async function enviar() {
    setEnviando(true);
    const out: { nome: string; ok: boolean; erro?: string }[] = [];
    for (const c of escolhidas) {
      try {
        await api(`/api/conversations/${c.id}/messages`, { method: "POST", body: JSON.stringify({ encaminhar: msg.id }) });
        out.push({ nome: nome(c), ok: true });
      } catch (e) {
        out.push({ nome: nome(c), ok: false, erro: e instanceof Error ? e.message : "falhou" });
      }
      setRes([...out]);
    }
    setEnviando(false);
    onDone();
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal zx-enc" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>↪ Encaminhar mensagem</h3>
        <div className="zx-enc-msg">{resumo}</div>
        {res ? (
          <>
            {res.map((r, i) => (
              <div key={i} className={r.ok ? "zx-ok" : "zx-erro"}>
                {r.ok ? "✅" : "⚠"} {r.nome}
                {r.erro ? `: ${r.erro}` : ""}
              </div>
            ))}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="primary" disabled={enviando} onClick={onClose}>{enviando ? "Enviando…" : "Fechar"}</button>
            </div>
          </>
        ) : (
          <>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar cliente ou número…" />
            {escolhidas.length > 0 && (
              <div className="zx-enc-esc">
                {escolhidas.map((c) => (
                  <button key={c.id} type="button" onClick={() => setEscolhidas(escolhidas.filter((x) => x.id !== c.id))} title="Tirar">
                    {nome(c)} ×
                  </button>
                ))}
              </div>
            )}
            <div className="zx-enc-lista">
              {lista === null && <p className="muted">Carregando…</p>}
              {lista?.length === 0 && <p className="muted">Nenhuma conversa encontrada.</p>}
              {lista?.map((c) => {
                const on = escolhidas.some((x) => x.id === c.id);
                const cheio = !on && escolhidas.length >= MAX_ENCAMINHAR;
                return (
                  <label key={c.id} className={`zx-enc-it${on ? " on" : ""}${cheio ? " off" : ""}`}>
                    <input type="checkbox" checked={on} disabled={cheio} onChange={() => setEscolhidas(on ? escolhidas.filter((x) => x.id !== c.id) : [...escolhidas, c])} />
                    <span>
                      <b>{nome(c)}</b>
                      <small className="muted">
                        {c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone)}
                        {c.connection ? ` · 📱 ${c.connection.name}` : ""}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              Até {MAX_ENCAMINHAR} conversas por vez, para proteger o número contra bloqueio (o WhatsApp pune a mesma mensagem para muitos contatos).
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose}>Cancelar</button>
              <button className="primary" disabled={!escolhidas.length || enviando} onClick={enviar}>
                Encaminhar{escolhidas.length ? ` (${escolhidas.length})` : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Catálogo -------------------------------- */

export type ItemCatalogo = { id: string; nome: string; preco: string; descricao: string; foto: string | null };
export const fotoCatalogo = (i: ItemCatalogo) => `/api/catalogo/foto?id=${encodeURIComponent(i.id)}&v=${encodeURIComponent(i.foto ?? "")}`;
export function textoProduto(i: ItemCatalogo) {
  return [`*${i.nome}*`, i.preco && `💲 ${i.preco}`, i.descricao].filter(Boolean).join("\n");
}

function lerBase64(f: File) {
  return new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fail(new Error("Não consegui ler a foto"));
    r.readAsDataURL(f);
  });
}

/** Catálogo de produtos: escolher um produto coloca a foto e a descrição na caixa de mensagem. */
export function CatalogoPop({ podeEditar, onUsar, onClose }: { podeEditar: boolean; onUsar: (i: ItemCatalogo) => void; onClose: () => void }) {
  const [itens, setItens] = useState<ItemCatalogo[] | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<(Partial<ItemCatalogo> & { arquivo?: File | null; tirarFoto?: boolean }) | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(() => api<ItemCatalogo[]>("/api/catalogo").then(setItens).catch(() => setItens([])), []);
  useEffect(() => {
    carregar();
  }, [carregar]);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    setErro("");
    try {
      const foto = form.arquivo ? { data: await lerBase64(form.arquivo), mimeType: form.arquivo.type } : form.tirarFoto ? null : undefined;
      await api("/api/catalogo", { method: "POST", body: JSON.stringify({ id: form.id, nome: form.nome, preco: form.preco, descricao: form.descricao, foto }) });
      setForm(null);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não consegui salvar");
    } finally {
      setSalvando(false);
    }
  }
  async function apagar(i: ItemCatalogo) {
    if (!confirm(`Tirar "${i.nome}" do catálogo?`)) return;
    await api(`/api/catalogo?id=${i.id}`, { method: "DELETE" }).catch((err) => alert(err.message));
    await carregar();
  }
  const filtrados = (itens ?? []).filter((i) => !q.trim() || (i.nome + " " + i.descricao).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="zx-cat" role="dialog" aria-label="Catálogo de produtos" onClick={(e) => e.stopPropagation()}>
      <div className="zx-h">
        🛍 Catálogo de produtos
        <span style={{ flex: 1 }} />
        {podeEditar && !form && (
          <button type="button" className="zx-mini" onClick={() => setForm({ nome: "", preco: "", descricao: "" })}>+ Produto</button>
        )}
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      {form ? (
        <form className="zx-cat-form" onSubmit={salvar}>
          <input autoFocus value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome (ex.: Sacola kraft 30x40)" required />
          <input value={form.preco ?? ""} onChange={(e) => setForm({ ...form, preco: e.target.value })} placeholder="Preço (ex.: a partir de R$ 1,20 a unidade)" />
          <textarea value={form.descricao ?? ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={3} placeholder="Descrição: medidas, material, quantidade mínima, prazo…" />
          <label className="zx-cat-foto">
            📷 {form.arquivo ? form.arquivo.name : form.foto && !form.tirarFoto ? "Trocar foto" : "Escolher foto"}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => setForm({ ...form, arquivo: e.target.files?.[0] ?? null, tirarFoto: false })} />
          </label>
          {form.foto && !form.tirarFoto && !form.arquivo && (
            <button type="button" className="zx-mini" onClick={() => setForm({ ...form, tirarFoto: true })}>Tirar a foto</button>
          )}
          {erro && <span className="zx-erro">{erro}</span>}
          <span className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setForm(null)}>Cancelar</button>
            <button className="primary" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
          </span>
        </form>
      ) : (
        <>
          {(itens?.length ?? 0) > 5 && <input className="zx-cat-busca" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto…" />}
          <div className="zx-cat-lista">
            {itens === null && <p className="muted">Carregando…</p>}
            {itens?.length === 0 && (
              <p className="muted">
                Nenhum produto ainda.{podeEditar ? " Clique em + Produto para montar o catálogo." : " Peça ao administrador para cadastrar os produtos."}
              </p>
            )}
            {filtrados.map((i) => (
              <div key={i.id} className="zx-cat-it">
                {i.foto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fotoCatalogo(i)} alt="" loading="lazy" />
                ) : (
                  <span className="zx-cat-semfoto">🛍</span>
                )}
                <span className="zx-cat-tx">
                  <b>{i.nome}</b>
                  {i.preco && <small className="zx-preco">{i.preco}</small>}
                  {i.descricao && <small className="muted">{i.descricao.slice(0, 90)}</small>}
                </span>
                <span className="zx-cat-acts">
                  <button type="button" className="primary" onClick={() => onUsar(i)}>Usar</button>
                  {podeEditar && (
                    <>
                      <button type="button" className="zx-mini" onClick={() => setForm({ ...i })} title="Editar">✏️</button>
                      <button type="button" className="zx-mini" onClick={() => apagar(i)} title="Tirar do catálogo">🗑</button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
          <span className="pd-dica">O produto vai para a caixa de mensagem com foto e descrição: confira e clique em Enviar.</span>
        </>
      )}
    </div>
  );
}
