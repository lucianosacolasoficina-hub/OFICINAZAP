"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useMe } from "@/lib/useMe";

type Perm = { key: string; label: string; desc: string; padrao: boolean };
type Row = { id: string; name: string; email: string; role: "admin" | "agent"; permissions: Record<string, boolean>; active: boolean };
type Draft = { id?: string; name: string; email: string; password: string; role: "admin" | "agent"; permissions: Record<string, boolean>; active: boolean };

export default function TeamPage() {
  const me = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api<{ agents: Row[]; perms: Perm[] }>("/api/team").then((r) => {
      setRows(r.agents);
      setPerms(r.perms);
    });

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const valor = (d: { role: string; permissions: Record<string, boolean> }, p: Perm) =>
    d.role === "admin" ? true : d.permissions[p.key] ?? p.padrao;

  const novo = () =>
    setDraft({ name: "", email: "", password: "", role: "agent", active: true, permissions: Object.fromEntries(perms.map((p) => [p.key, p.padrao])) });

  const editar = (r: Row) =>
    setDraft({ id: r.id, name: r.name, email: r.email, password: "", role: r.role, active: r.active, permissions: Object.fromEntries(perms.map((p) => [p.key, valor(r, p)])) });

  async function salvar() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      if (draft.id) {
        await api(`/api/team/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: draft.name, role: draft.role, permissions: draft.permissions, active: draft.active, ...(draft.password ? { password: draft.password } : {}) }),
        });
        setNotice(`Permissões de ${draft.name} salvas.`);
      } else {
        await api("/api/team", { method: "POST", body: JSON.stringify(draft) });
        setNotice(`${draft.name} cadastrado. Passe para ele o e-mail e a senha inicial para entrar no OficinaZap.`);
      }
      setDraft(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (me && me.role !== "admin") {
    return (
      <div className="page">
        <h1>Equipe e permissões</h1>
        <p className="muted">Só o administrador pode ver e alterar as permissões da equipe.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Equipe e permissões</h1>
        <div style={{ flex: 1 }} />
        <button className="primary" onClick={novo} disabled={!perms.length}>+ Novo atendente</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        O <b>administrador</b> pode tudo. Para cada <b>atendente</b>, escolha o que ele pode fazer. Desativar bloqueia o acesso sem apagar as conversas dele.
      </p>
      {notice && <div className="card" style={{ borderColor: "var(--brand)" }}>{notice}</div>}
      {error && !draft && <div className="card" style={{ color: "var(--danger)" }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="eq-tab">
          <thead>
            <tr>
              <th>Atendente</th>
              <th>Papel</th>
              {perms.map((p) => <th key={p.key} title={p.desc}>{p.label}</th>)}
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={r.active ? undefined : { opacity: 0.5 }}>
                <td><b>{r.name}</b>{r.id === me?.id && " (você)"}<br /><span className="muted">{r.email}</span></td>
                <td>{r.role === "admin" ? "Administrador" : "Atendente"}</td>
                {perms.map((p) => <td key={p.key} style={{ textAlign: "center" }}>{valor(r, p) ? "✅" : "—"}</td>)}
                <td>{r.active ? "Ativo" : "Desativado"}</td>
                <td><button onClick={() => editar(r)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="modal-bg" onClick={() => setDraft(null)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <strong>{draft.id ? `Editar ${draft.name}` : "Novo atendente"}</strong>
            <label>Nome<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            {!draft.id && <label>E-mail (login)<input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>}
            <label>
              {draft.id ? "Nova senha (deixe em branco para não trocar)" : "Senha inicial (mínimo 8 caracteres)"}
              <input type="text" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            </label>
            <label>
              Papel
              <select value={draft.role} disabled={draft.id === me?.id} onChange={(e) => setDraft({ ...draft, role: e.target.value as Draft["role"] })}>
                <option value="agent">Atendente: só o que estiver marcado abaixo</option>
                <option value="admin">Administrador: pode tudo e gerencia a equipe</option>
              </select>
            </label>
            {draft.role === "agent" && (
              <div className="eq-perms">
                {perms.map((p) => (
                  <label key={p.key} className="eq-perm">
                    <input
                      type="checkbox"
                      checked={!!draft.permissions[p.key]}
                      onChange={(e) => setDraft({ ...draft, permissions: { ...draft.permissions, [p.key]: e.target.checked } })}
                    />
                    <span><b>{p.label}</b><br /><small className="muted">{p.desc}</small></span>
                  </label>
                ))}
              </div>
            )}
            {draft.id && draft.id !== me?.id && (
              <label className="eq-perm">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                <span><b>Acesso ativo</b><br /><small className="muted">Desmarque para bloquear a entrada deste atendente</small></span>
              </label>
            )}
            {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setDraft(null)}>Cancelar</button>
              <button className="primary" onClick={salvar} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
