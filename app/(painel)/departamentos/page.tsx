"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { Department } from "@/lib/db";

type Row = Department & { agent_ids: string[] };
type Agent = { id: string; name: string };
type Draft = { id?: string; name: string; description: string; color: string; active: boolean; agent_ids: string[] };

const EMPTY: Draft = { name: "", description: "", color: "#128c4a", active: true, agent_ids: [] };

export default function DepartmentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"active" | "inactive" | "all">("active");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api<{ departments: Row[]; agents: Agent[] }>("/api/departments").then((r) => {
      setRows(r.departments);
      setAgents(r.agents);
    });

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (d) =>
        (show === "all" || d.active === (show === "active")) &&
        (!term || d.name.toLowerCase().includes(term)),
    );
  }, [rows, q, show]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const { id, ...body } = draft;
      if (id) {
        await api(`/api/departments/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const created = await api<Department>("/api/departments", { method: "POST", body: JSON.stringify(body) });
        await api(`/api/departments/${created.id}`, { method: "PATCH", body: JSON.stringify({ agent_ids: body.agent_ids }) });
      }
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    if (!confirm(`Excluir o departamento "${draft.name}"? As conversas dele ficam sem departamento.`)) return;
    await api(`/api/departments/${draft.id}`, { method: "DELETE" });
    setDraft(null);
    await load();
  }

  function toggleAgent(id: string) {
    if (!draft) return;
    const has = draft.agent_ids.includes(id);
    setDraft({ ...draft, agent_ids: has ? draft.agent_ids.filter((a) => a !== id) : [...draft.agent_ids, id] });
  }

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Departamentos</h1>
        <button className="primary" onClick={() => setDraft({ ...EMPTY })}>+ Criar novo</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Separe o atendimento por setor. Cada conversa pode ser transferida para um departamento, e os atendentes dele
        veem essa conversa no filtro &quot;Meus departamentos&quot;. A IA também encaminha o cliente para o departamento certo
        usando a descrição de cada um.
      </p>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Pesquisar..." value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} style={{ maxWidth: 180 }}>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="all">Todos</option>
        </select>
      </div>

      <table>
        <thead>
          <tr><th>Nome</th><th>Quando a IA encaminha</th><th>Atendentes</th><th>Criado em</th></tr>
        </thead>
        <tbody>
          {visible.map((d) => (
            <tr key={d.id} onClick={() => setDraft({ ...d })} style={{ cursor: "pointer" }}>
              <td>
                <span className="dot" style={{ background: d.color }} />
                <strong>{d.name}</strong>
                {!d.active && <span className="muted"> (inativo)</span>}
              </td>
              <td className="muted">{d.description || "Só por transferência manual"}</td>
              <td className="muted">
                {d.agent_ids.length === 0 ? "nenhum" : `${d.agent_ids.length} atendente${d.agent_ids.length > 1 ? "s" : ""}`}
              </td>
              <td className="muted">{new Date(d.created_at).toLocaleDateString("pt-BR")}</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={4} className="muted">Nenhum departamento encontrado.</td></tr>
          )}
        </tbody>
      </table>

      {draft && (
        <div className="modal-bg" onClick={() => setDraft(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <strong>{draft.id ? "Editar departamento" : "Novo departamento"}</strong>
            <label>
              Nome
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required autoFocus />
            </label>
            <label>
              Quando a IA deve mandar o cliente para cá
              <textarea
                rows={3}
                placeholder="Ex.: pagamentos, boletos, notas fiscais. Deixe vazio para só transferir manualmente."
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <div className="row">
              <label className="row" style={{ width: "auto" }}>
                Cor
                <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} style={{ width: 48, padding: 2 }} />
              </label>
              <label className="row" style={{ width: "auto", marginLeft: 16 }}>
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} style={{ width: "auto" }} />
                Ativo
              </label>
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>Atendentes</div>
              {agents.length === 0 && <p className="muted">Nenhum atendente cadastrado ainda.</p>}
              <div className="checks">
                {agents.map((a) => (
                  <label key={a.id} className="row">
                    <input type="checkbox" checked={draft.agent_ids.includes(a.id)} onChange={() => toggleAgent(a.id)} style={{ width: "auto" }} />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</button>
              <button type="button" onClick={() => setDraft(null)}>Cancelar</button>
              <span style={{ flex: 1 }} />
              {draft.id && <button type="button" className="danger" onClick={remove}>Excluir</button>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
