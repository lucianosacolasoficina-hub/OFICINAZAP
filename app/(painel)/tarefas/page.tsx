"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatPhone } from "@/lib/client";
import { useMe } from "@/lib/useMe";

type Col = { id: string; name: string; color: string; position: number; done: boolean };
type Card = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  due_date: string | null;
  position: number;
  labels: string[];
  checklist: { t: string; ok: boolean }[];
  conversation_id: string | null;
  contact: { name: string | null; phone: string } | null;
  comentarios?: { count: number }[];
  done_at: string | null;
};
type Data = { boards: { id: string; name: string }[]; board: { id: string; name: string } | null; columns: Col[]; cards: Card[]; agents: { id: string; name: string }[] };

const hoje = () => new Date().toISOString().slice(0, 10);
const dBR = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const CORES = ["#6b7280", "#2b6cb0", "#6b46c1", "#b83280", "#c05621", "#d69e2e", "#128c4a", "#2c7a7b", "#c53030"];
const iniciais = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");

export default function TarefasPage() {
  const me = useMe();
  const [quadro, setQuadro] = useState<string>("");
  const [data, setData] = useState<Data | null>(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<"todas" | "minhas" | string>("todas");
  const [busca, setBusca] = useState("");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [novoEm, setNovoEm] = useState<string | null>(null);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [aberto, setAberto] = useState<Card | null>(null);
  const [novaCol, setNovaCol] = useState("");

  const load = useCallback(
    () =>
      api<Data>(`/api/tarefas${quadro ? `?quadro=${quadro}` : ""}`)
        .then((d) => {
          setData(d);
          setErro("");
          if (!quadro && d.board) setQuadro(d.board.id);
        })
        .catch((e) => setErro(e.message)),
    [quadro],
  );
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  const nome = (id: string | null) => data?.agents.find((a) => a.id === id)?.name ?? "";
  const cards = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (data?.cards ?? []).filter(
      (c) =>
        (filtro === "todas" || (filtro === "minhas" ? c.assignee === me?.id : c.assignee === filtro)) &&
        (!q || c.title.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q) || (c.contact?.name ?? "").toLowerCase().includes(q)),
    );
  }, [data, filtro, busca, me?.id]);

  async function mover(cardId: string, colId: string, antesDe?: string) {
    if (!data) return;
    const coluna = data.cards.filter((c) => c.column_id === colId && c.id !== cardId).sort((a, b) => a.position - b.position);
    const i = antesDe ? coluna.findIndex((c) => c.id === antesDe) : -1;
    const pos = i === -1 ? (coluna[coluna.length - 1]?.position ?? 0) + 1000 : i === 0 ? coluna[0].position - 1000 : (coluna[i - 1].position + coluna[i].position) / 2;
    setData({ ...data, cards: data.cards.map((c) => (c.id === cardId ? { ...c, column_id: colId, position: pos } : c)).sort((a, b) => a.position - b.position) });
    await api(`/api/tarefas/cards/${cardId}`, { method: "PATCH", body: JSON.stringify({ column_id: colId, position: pos }) }).catch((e) => alert(e.message));
    load();
  }

  function soltar(e: React.DragEvent, colId: string, antesDe?: string) {
    e.preventDefault();
    e.stopPropagation();
    setSobre(null);
    if (arrastando && arrastando !== antesDe) mover(arrastando, colId, antesDe);
    setArrastando(null);
  }

  async function criarCartao(colId: string) {
    const t = novoTitulo.trim();
    if (!t) return setNovoEm(null);
    setNovoTitulo("");
    await api("/api/tarefas/cards", { method: "POST", body: JSON.stringify({ column_id: colId, title: t }) }).catch((e) => alert(e.message));
    load();
  }

  async function criarColuna() {
    if (!novaCol.trim() || !data?.board) return;
    await api("/api/tarefas/colunas", { method: "POST", body: JSON.stringify({ board_id: data.board.id, name: novaCol }) }).catch((e) => alert(e.message));
    setNovaCol("");
    load();
  }

  async function editarColuna(c: Col) {
    const n = prompt("Nome da coluna:", c.name);
    if (n === null) return;
    await api(`/api/tarefas/colunas/${c.id}`, { method: "PATCH", body: JSON.stringify({ name: n }) }).catch((e) => alert(e.message));
    load();
  }
  async function corColuna(c: Col) {
    const i = CORES.indexOf(c.color);
    await api(`/api/tarefas/colunas/${c.id}`, { method: "PATCH", body: JSON.stringify({ color: CORES[(i + 1) % CORES.length] }) });
    load();
  }
  async function apagarColuna(c: Col) {
    const n = (data?.cards ?? []).filter((x) => x.column_id === c.id).length;
    if (!confirm(`Apagar a coluna "${c.name}"${n ? ` e os ${n} cartões dela` : ""}?`)) return;
    await api(`/api/tarefas/colunas/${c.id}`, { method: "DELETE" }).catch((e) => alert(e.message));
    load();
  }
  async function novoQuadro() {
    const n = prompt("Nome do novo quadro (ex.: Produção, Marketing):");
    if (!n?.trim()) return;
    const b = await api<{ id: string }>("/api/tarefas", { method: "POST", body: JSON.stringify({ name: n }) }).catch((e) => { alert(e.message); return null; });
    if (b) setQuadro(b.id);
  }
  async function renomearQuadro() {
    if (!data?.board) return;
    const n = prompt("Nome do quadro:", data.board.name);
    if (!n?.trim()) return;
    await api(`/api/tarefas/quadros/${data.board.id}`, { method: "PATCH", body: JSON.stringify({ name: n }) });
    load();
  }
  async function apagarQuadro() {
    if (!data?.board || !confirm(`Apagar o quadro "${data.board.name}" com todas as colunas e cartões? Não dá para desfazer.`)) return;
    await api(`/api/tarefas/quadros/${data.board.id}`, { method: "DELETE" }).catch((e) => alert(e.message));
    setQuadro("");
  }

  if (!data) return <div className="page">{erro ? <span style={{ color: "crimson" }}>{erro}</span> : "Carregando..."}</div>;

  return (
    <div className="page kb-page">
      <div className="kb-top">
        <h1 style={{ margin: 0 }}>Tarefas</h1>
        <select value={data.board?.id ?? ""} onChange={(e) => setQuadro(e.target.value)} title="Quadro">
          {data.boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button onClick={novoQuadro}>+ Quadro</button>
        {data.board && <button onClick={renomearQuadro} title="Renomear quadro">✏️</button>}
        {data.board && me?.role === "admin" && data.boards.length > 1 && <button onClick={apagarQuadro} title="Apagar quadro">🗑</button>}
        <span className="kb-sp" />
        <input placeholder="Buscar tarefa…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} title="Filtrar por responsável">
          <option value="todas">Todas</option>
          <option value="minhas">Minhas</option>
          {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="kb-board">
        {data.columns.map((col) => {
          const lista = cards.filter((c) => c.column_id === col.id).sort((a, b) => a.position - b.position);
          return (
            <div
              key={col.id}
              className={`kb-col${sobre === col.id ? " over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setSobre(col.id); }}
              onDragLeave={() => setSobre((s) => (s === col.id ? null : s))}
              onDrop={(e) => soltar(e, col.id)}
            >
              <div className="kb-col-h">
                <span className="kb-dot" style={{ background: col.color }} onClick={() => corColuna(col)} title="Trocar a cor" />
                <b onDoubleClick={() => editarColuna(col)} title="Clique duas vezes para renomear">{col.name}</b>
                {col.done && <span className="kb-done" title="Cartões aqui contam como concluídos">✓</span>}
                <span className="kb-n">{lista.length}</span>
                <details className="kb-menu">
                  <summary>⋯</summary>
                  <div>
                    <button onClick={() => editarColuna(col)}>Renomear</button>
                    <button onClick={() => corColuna(col)}>Trocar a cor</button>
                    <button onClick={async () => { await api(`/api/tarefas/colunas/${col.id}`, { method: "PATCH", body: JSON.stringify({ done: !col.done }) }); load(); }}>
                      {col.done ? "Não é coluna de concluídas" : "Marcar como concluídas"}
                    </button>
                    <button className="kb-del" onClick={() => apagarColuna(col)}>Apagar coluna</button>
                  </div>
                </details>
              </div>
              <div className="kb-cards">
                {lista.map((c) => {
                  const atrasado = c.due_date && !col.done && c.due_date < hoje();
                  const feitos = c.checklist.filter((i) => i.ok).length;
                  const nCom = c.comentarios?.[0]?.count ?? 0;
                  return (
                    <div
                      key={c.id}
                      className={`kb-card${arrastando === c.id ? " drag" : ""}${col.done ? " fim" : ""}`}
                      draggable
                      onDragStart={() => setArrastando(c.id)}
                      onDragEnd={() => setArrastando(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => soltar(e, col.id, c.id)}
                      onClick={() => setAberto(c)}
                    >
                      {c.labels.length > 0 && <div className="kb-labels">{c.labels.map((l) => <span key={l}>{l}</span>)}</div>}
                      <div className="kb-t">{c.title}</div>
                      {c.contact && <div className="kb-cli">💬 {c.contact.name || formatPhone(c.contact.phone)}</div>}
                      <div className="kb-meta">
                        {c.due_date && <span className={atrasado ? "late" : ""}>📅 {dBR(c.due_date)}</span>}
                        {c.checklist.length > 0 && <span className={feitos === c.checklist.length ? "ok" : ""}>☑ {feitos}/{c.checklist.length}</span>}
                        {nCom > 0 && <span>💭 {nCom}</span>}
                        {c.description && <span title="Tem descrição">≡</span>}
                        <span className="kb-sp" />
                        {c.assignee && <span className="kb-av" title={nome(c.assignee)}>{iniciais(nome(c.assignee) || "?")}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {novoEm === col.id ? (
                <div className="kb-add">
                  <textarea
                    autoFocus
                    rows={2}
                    value={novoTitulo}
                    placeholder="Título da tarefa (Enter para salvar)"
                    onChange={(e) => setNovoTitulo(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); criarCartao(col.id); }
                      if (e.key === "Escape") setNovoEm(null);
                    }}
                  />
                  <div className="row" style={{ gap: 6 }}>
                    <button className="primary" onClick={() => criarCartao(col.id)}>Adicionar</button>
                    <button onClick={() => { setNovoEm(null); setNovoTitulo(""); }}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <button className="kb-add-btn" onClick={() => { setNovoEm(col.id); setNovoTitulo(""); }}>+ Adicionar cartão</button>
              )}
            </div>
          );
        })}
        {data.board && (
          <div className="kb-col kb-newcol">
            <input placeholder="+ Nova coluna" value={novaCol} onChange={(e) => setNovaCol(e.target.value)} onKeyDown={(e) => e.key === "Enter" && criarColuna()} />
            {novaCol.trim() && <button className="primary" onClick={criarColuna}>Criar coluna</button>}
          </div>
        )}
      </div>

      {aberto && (
        <CardModal
          card={aberto}
          columns={data.columns}
          agents={data.agents}
          onClose={() => setAberto(null)}
          onSaved={() => { load(); }}
        />
      )}
    </div>
  );
}

function CardModal({ card, columns, agents, onClose, onSaved }: { card: Card; columns: Col[]; agents: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState(card);
  const [etiquetas, setEtiquetas] = useState(card.labels.join(", "));
  const [novoItem, setNovoItem] = useState("");
  const [coms, setComs] = useState<{ id: string; body: string; created_at: string; agent: { name: string } | null }[]>([]);
  const [com, setCom] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<typeof coms>(`/api/tarefas/cards/${card.id}/comentarios`).then(setComs).catch(() => {});
  }, [card.id]);

  async function salvar(extra?: Partial<Card>, fechar = true) {
    setSalvando(true);
    const d = { ...c, ...extra };
    try {
      await api(`/api/tarefas/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: d.title,
          description: d.description,
          assignee: d.assignee,
          due_date: d.due_date,
          column_id: d.column_id,
          checklist: d.checklist,
          labels: etiquetas.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      onSaved();
      if (fechar) onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function comentar() {
    if (!com.trim()) return;
    const r = await api<(typeof coms)[number]>(`/api/tarefas/cards/${card.id}/comentarios`, { method: "POST", body: JSON.stringify({ body: com }) }).catch((e) => { alert(e.message); return null; });
    if (r) { setComs([...coms, r]); setCom(""); onSaved(); }
  }

  async function apagar() {
    if (!confirm("Apagar esta tarefa?")) return;
    await api(`/api/tarefas/cards/${card.id}`, { method: "DELETE" }).catch((e) => alert(e.message));
    onSaved();
    onClose();
  }

  const setItem = (i: number, p: Partial<{ t: string; ok: boolean }>) => setC({ ...c, checklist: c.checklist.map((x, k) => (k === i ? { ...x, ...p } : x)) });

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal kb-modal" onClick={(e) => e.stopPropagation()}>
        <input className="kb-mt" value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />
        <div className="kb-grid">
          <label>Coluna
            <select value={c.column_id} onChange={(e) => setC({ ...c, column_id: e.target.value })}>
              {columns.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
          <label>Responsável
            <select value={c.assignee ?? ""} onChange={(e) => setC({ ...c, assignee: e.target.value || null })}>
              <option value="">Ninguém</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Prazo<input type="date" value={c.due_date ?? ""} onChange={(e) => setC({ ...c, due_date: e.target.value || null })} /></label>
          <label>Etiquetas<input value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)} placeholder="urgente, arte, cliente" /></label>
        </div>
        <label>Descrição<textarea rows={4} value={c.description ?? ""} onChange={(e) => setC({ ...c, description: e.target.value })} placeholder="Detalhes da tarefa" /></label>
        {c.conversation_id && (
          <p style={{ margin: 0 }}>💬 Ligada à conversa{c.contact ? ` com ${c.contact.name || formatPhone(c.contact.phone)}` : ""} — <a href={`/?c=${c.conversation_id}`}>abrir conversa</a></p>
        )}
        <div>
          <b>Checklist</b>
          {c.checklist.map((i, k) => (
            <div key={k} className="kb-check">
              <input type="checkbox" checked={i.ok} onChange={(e) => setItem(k, { ok: e.target.checked })} />
              <input value={i.t} onChange={(e) => setItem(k, { t: e.target.value })} />
              <button onClick={() => setC({ ...c, checklist: c.checklist.filter((_, x) => x !== k) })} title="Remover">×</button>
            </div>
          ))}
          <div className="kb-check">
            <input
              value={novoItem}
              placeholder="+ item do checklist (Enter)"
              onChange={(e) => setNovoItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && novoItem.trim()) { setC({ ...c, checklist: [...c.checklist, { t: novoItem.trim(), ok: false }] }); setNovoItem(""); } }}
            />
          </div>
        </div>
        <div>
          <b>Comentários</b>
          <div className="kb-coms">
            {coms.length === 0 && <p className="muted" style={{ margin: "4px 0" }}>Nenhum comentário.</p>}
            {coms.map((x) => (
              <div key={x.id} className="kb-com"><b>{x.agent?.name ?? "—"}</b> <span className="muted">{new Date(x.created_at).toLocaleString("pt-BR").slice(0, 16)}</span><div>{x.body}</div></div>
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input style={{ flex: 1 }} value={com} onChange={(e) => setCom(e.target.value)} placeholder="Escreva um comentário" onKeyDown={(e) => e.key === "Enter" && comentar()} />
            <button onClick={comentar}>Comentar</button>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="kb-del" onClick={apagar}>Apagar tarefa</button>
          <span style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}>Cancelar</button>
            <button className="primary" disabled={salvando} onClick={() => salvar()}>{salvando ? "Salvando…" : "Salvar"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
