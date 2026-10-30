"use client";

import { useEffect, useMemo, useState } from "react";
import { api, formatPhone } from "@/lib/client";
import { useMe } from "@/lib/useMe";

type Row = { id: string; status: string; agent: string | null; nome: string; phone: string; stage: string | null; valor: number | null; last: string; preview: string | null };
type Data = { stages: { key: string; label: string }[]; agents: { id: string; name: string; active: boolean }[]; rows: Row[] };

const SIT = [
  { key: "waiting", label: "Aguardando atendimento", cor: "#d97706" },
  { key: "open", label: "Em atendimento", cor: "#16a34a" },
  { key: "bot", label: "Com a IA", cor: "#5b3df5" },
  { key: "closed", label: "Encerradas", cor: "#6b7280" },
];
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AtendimentosPage() {
  const me = useMe();
  const [dias, setDias] = useState(30);
  const [d, setD] = useState<Data | null>(null);
  const [erro, setErro] = useState("");
  const [sel, setSel] = useState<{ agent: string; tipo: "sit" | "stage" | "total"; key: string } | null>(null);

  useEffect(() => {
    setD(null);
    api<Data>(`/api/team/atendimentos?dias=${dias}`).then(setD).catch((e) => setErro(e.message));
  }, [dias]);

  const linhas = useMemo(() => {
    if (!d) return [];
    const ags = d.agents.filter((a) => a.active || d.rows.some((r) => r.agent === a.id));
    return [...ags.map((a) => ({ id: a.id, nome: a.name })), { id: "__sem", nome: "Sem atendente (fila)" }];
  }, [d]);

  if (me && me.role !== "admin")
    return (
      <div className="page">
        <h1>Atendimentos por atendente</h1>
        <p className="muted">Só o administrador vê esta tela.</p>
      </div>
    );

  const doAgente = (id: string) => (d?.rows ?? []).filter((r) => (id === "__sem" ? !r.agent : r.agent === id));
  const lista = sel
    ? doAgente(sel.agent).filter((r) => sel.tipo === "total" || (sel.tipo === "sit" ? r.status === sel.key : r.stage === sel.key))
    : [];
  const cel = (agent: string, tipo: "sit" | "stage" | "total", key: string, n: number, cor?: string) => (
    <td className="r">
      {n ? (
        <button className={`at-n${sel && sel.agent === agent && sel.tipo === tipo && sel.key === key ? " on" : ""}`} style={cor ? { color: cor } : undefined} onClick={() => setSel({ agent, tipo, key })}>
          {n}
        </button>
      ) : (
        <span className="muted">—</span>
      )}
    </td>
  );
  const nomeSel = sel ? linhas.find((l) => l.id === sel.agent)?.nome : "";
  const rotSel = sel ? (sel.tipo === "total" ? "Todos" : sel.tipo === "sit" ? SIT.find((s) => s.key === sel.key)?.label : d?.stages.find((s) => s.key === sel.key)?.label) : "";

  return (
    <div className="page" style={{ maxWidth: 1300 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Atendimentos por atendente</h1>
        <div style={{ flex: 1 }} />
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Encerradas dos últimos
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} style={{ width: "auto" }}>
            <option value={7}>7 dias</option>
            <option value={30}>30 dias</option>
            <option value={90}>90 dias</option>
            <option value={0}>todo o período</option>
          </select>
        </label>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Clique num número para ver os clientes. Conversas em aberto aparecem sempre; as encerradas, do período escolhido. Grupos ficam de fora.</p>
      {erro && <div className="card" style={{ color: "var(--danger)" }}>{erro}</div>}
      {!d ? (
        <p className="muted">Carregando…</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="eq-tab at-tab">
            <thead>
              <tr>
                <th rowSpan={2}>Atendente</th>
                <th colSpan={SIT.length} className="at-grp">Situação da conversa</th>
                <th colSpan={d.stages.length} className="at-grp">Etapa no funil de vendas</th>
                <th rowSpan={2} className="r">Total</th>
              </tr>
              <tr>
                {SIT.map((s) => <th key={s.key} className="r">{s.label}</th>)}
                {d.stages.map((s) => <th key={s.key} className="r">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const rs = doAgente(l.id);
                return (
                  <tr key={l.id}>
                    <td><b>{l.nome}</b></td>
                    {SIT.map((s) => cel(l.id, "sit", s.key, rs.filter((r) => r.status === s.key).length, s.cor))}
                    {d.stages.map((s) => cel(l.id, "stage", s.key, rs.filter((r) => r.stage === s.key).length))}
                    {cel(l.id, "total", "", rs.length)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <strong>{nomeSel} · {rotSel} ({lista.length})</strong>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSel(null)}>Fechar</button>
          </div>
          <table className="eq-tab">
            <thead>
              <tr><th>Cliente</th><th>Situação</th><th>Funil</th><th>Última mensagem</th><th /></tr>
            </thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.nome}</b><br /><span className="muted">{formatPhone(r.phone)}</span></td>
                  <td>{SIT.find((s) => s.key === r.status)?.label ?? r.status}</td>
                  <td>{d?.stages.find((s) => s.key === r.stage)?.label ?? "—"}{r.valor ? ` · ${brl(r.valor)}` : ""}</td>
                  <td><span className="muted">{quando(r.last)}</span><br />{(r.preview ?? "").slice(0, 90)}</td>
                  <td><a href={`/?c=${r.id}`}><button>Abrir</button></a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
