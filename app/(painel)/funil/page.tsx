"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, formatPhone } from "@/lib/client";
import type { QuoteData } from "@/lib/db";
import { STAGES, type Deal, type Stage } from "@/lib/stages";

type DealRow = Deal & { contact: { name: string | null; phone: string }; quote: QuoteData | null };

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function FunnelPage() {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [editing, setEditing] = useState<DealRow | null>(null);

  const load = useCallback(() => api<DealRow[]>("/api/deals").then(setDeals).catch(console.error), []);
  useEffect(() => {
    load();
  }, [load]);

  /** Move o card para a etapa, antes do card `beforeId` (ou no fim da coluna). */
  async function move(id: string, stage: Stage, beforeId?: string) {
    const column = deals.filter((d) => d.stage === stage && d.id !== id);
    let position: number;
    const idx = beforeId ? column.findIndex((d) => d.id === beforeId) : -1;
    if (idx === -1) position = (column[column.length - 1]?.position ?? 0) + 1000;
    else position = idx === 0 ? column[0].position - 1000 : (column[idx - 1].position + column[idx].position) / 2;

    setDeals((all) =>
      all
        .map((d) => (d.id === id ? { ...d, stage, position } : d))
        .sort((a, b) => a.position - b.position),
    );
    await api(`/api/deals/${id}`, { method: "PATCH", body: JSON.stringify({ stage, position }) });
  }

  function onDrop(e: React.DragEvent, stage: Stage, beforeId?: string) {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    if (dragId && dragId !== beforeId) move(dragId, stage, beforeId).catch(console.error);
    setDragId(null);
  }

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <h1>Funil de vendas</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Clientes que pediram orçamento entram aqui sozinhos, em &quot;Novo lead&quot;. Arraste os cards entre as colunas.
        Ao chegar em &quot;Pedido fechado&quot;, o cliente e o pedido de venda são criados no Bling (se ele estiver conectado).
      </p>
      <div className="board">
        {STAGES.map((s) => {
          const cards = deals.filter((d) => d.stage === s.key);
          const total = cards.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
          return (
            <div
              key={s.key}
              className={`column ${over === s.key ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s.key);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => onDrop(e, s.key)}
            >
              <div className="column-head">
                <strong>{s.label}</strong> <span className="muted">{cards.length}</span>
                {total > 0 && <div className="muted" style={{ fontSize: 12 }}>{money(total)}</div>}
              </div>
              {cards.map((d) => (
                <div
                  key={d.id}
                  className="deal"
                  draggable
                  onDragStart={() => setDragId(d.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(e, s.key, d.id)}
                  onClick={() => setEditing(d)}
                  style={{ opacity: dragId === d.id ? 0.4 : 1 }}
                >
                  <strong>{d.title}</strong>
                  <div className="muted">{d.contact.name || formatPhone(d.contact.phone)}</div>
                  {d.quote?.prazo_desejado && <div className="muted">Prazo: {d.quote.prazo_desejado}</div>}
                  {d.value != null && <div style={{ color: "var(--brand)", fontWeight: 600 }}>{money(Number(d.value))}</div>}
                  {d.bling_order_id && <span className="tag">Bling {d.bling_order_number ? `nº ${d.bling_order_number}` : "ok"}</span>}
                  {!d.bling_order_id && d.bling_error && <span className="tag" style={{ color: "crimson" }}>Erro no Bling</span>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {editing && (
        <DealModal
          deal={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function DealModal({ deal, onClose, onSaved }: { deal: DealRow; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(deal.title);
  const [value, setValue] = useState(deal.value != null ? String(deal.value) : "");
  const [notes, setNotes] = useState(deal.notes ?? "");
  const [stage, setStage] = useState<Stage>(deal.stage);

  async function save() {
    const parsed = value.trim() ? Number(value.replace(/\./g, "").replace(",", ".")) : null;
    await api(`/api/deals/${deal.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title, notes, stage, value: parsed != null && !Number.isNaN(parsed) ? parsed : null }),
    });
    onSaved();
  }

  const [bling, setBling] = useState({ busy: false, error: deal.bling_error, numero: deal.bling_order_number, sent: !!deal.bling_order_id });

  async function sendToBling() {
    setBling((b) => ({ ...b, busy: true, error: null }));
    try {
      const r = await api<{ id: number; numero: string | null }>(`/api/deals/${deal.id}/bling`, { method: "POST" });
      setBling({ busy: false, error: null, numero: r.numero, sent: true });
    } catch (e) {
      setBling((b) => ({ ...b, busy: false, error: e instanceof Error ? e.message : "erro" }));
    }
  }

  async function remove() {
    if (!confirm("Excluir este negócio do funil?")) return;
    await api(`/api/deals/${deal.id}`, { method: "DELETE" });
    onSaved();
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h1>Negócio</h1>
        <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>
          Etapa
          <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label>Valor (R$)<input value={value} onChange={(e) => setValue(e.target.value)} placeholder="ex.: 1.250,00" /></label>
        <label>Observações<textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {deal.quote && Object.keys(deal.quote).length > 0 && (
          <div className="muted" style={{ fontSize: 13 }}>
            <strong>Dados coletados pela IA:</strong>{" "}
            {Object.entries(deal.quote).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}
          </div>
        )}
        <div className="muted" style={{ fontSize: 13 }}>
          <strong>Bling:</strong>{" "}
          {bling.sent ? (
            `pedido de venda criado${bling.numero ? ` (nº ${bling.numero})` : ""}.`
          ) : (
            <>
              {bling.error ? <span style={{ color: "crimson" }}>{bling.error} </span> : "ainda não enviado. "}
              <button onClick={sendToBling} disabled={bling.busy}>
                {bling.busy ? "Enviando..." : bling.error ? "Tentar de novo" : "Enviar ao Bling"}
              </button>
            </>
          )}
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
          <button className="danger" onClick={remove}>Excluir</button>
          <div className="row">
            {deal.conversation_id && <Link href={`/?c=${deal.conversation_id}`}><button>Abrir conversa</button></Link>}
            <button onClick={onClose}>Cancelar</button>
            <button className="primary" onClick={save}>Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
