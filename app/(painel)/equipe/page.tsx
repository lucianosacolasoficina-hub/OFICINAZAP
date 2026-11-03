"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useMe } from "@/lib/useMe";

type Perm = { key: string; label: string; desc: string; padrao: boolean };
type Row = { id: string; name: string; email: string; role: "admin" | "agent"; permissions: Record<string, boolean | string[]>; active: boolean };
type Canal = { id: string; name: string; channel: string | null; phone: string | null };
type Draft = { id?: string; name: string; email: string; password: string; role: "admin" | "agent"; permissions: Record<string, boolean>; active: boolean; canais: string[] | null };

function gerarSenha() {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => letras[n % letras.length]).join("");
}

export default function TeamPage() {
  const me = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [canais, setCanais] = useState<Canal[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () =>
    api<{ agents: Row[]; perms: Perm[]; canais: Canal[] }>("/api/team").then((r) => {
      setCanais(r.canais ?? []);
      setRows(r.agents);
      setPerms(r.perms);
    });

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const valor = (d: { role: string; permissions: Record<string, boolean | string[]> }, p: Perm) =>
    d.role === "admin" ? true : (d.permissions[p.key] as boolean | undefined) ?? p.padrao;
  const canaisDe = (r: { permissions: Record<string, boolean | string[]> }) => (Array.isArray(r.permissions.canais) ? (r.permissions.canais as string[]) : null);
  const icone = (c: Canal) => (c.channel === "instagram" ? "📸" : c.channel === "messenger" ? "💬" : c.channel === "email" ? "✉️" : "📱");

  const novo = () =>
    setDraft({ name: "", email: "", password: "", role: "agent", active: true, canais: [], permissions: Object.fromEntries(perms.map((p) => [p.key, p.padrao])) });

  const editar = (r: Row) =>
    setDraft({ id: r.id, name: r.name, email: r.email, password: "", role: r.role, active: r.active, canais: canaisDe(r), permissions: Object.fromEntries(perms.map((p) => [p.key, valor(r, p)])) });

  async function salvar() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      if (draft.id) {
        await api(`/api/team/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: draft.name, role: draft.role, permissions: { ...draft.permissions, ...(draft.canais ? { canais: draft.canais } : {}) }, active: draft.active, ...(draft.password ? { password: draft.password } : {}) }),
        });
        setNotice(`Permissões de ${draft.name} salvas.`);
      } else {
        await api("/api/team", { method: "POST", body: JSON.stringify({ ...draft, permissions: { ...draft.permissions, canais: draft.canais ?? [] } }) });
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

  const senhaCurta = !!draft && draft.password.length > 0 && draft.password.length < 8;
  const podeSalvar =
    !!draft && draft.name.trim() !== "" && (draft.id ? !senhaCurta : draft.email.trim() !== "" && draft.password.length >= 8);
  const todasMarcadas = !!draft && perms.length > 0 && perms.every((p) => draft.permissions[p.key]);

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
              <th>Canais que vê</th>
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
                <td>{r.role === "admin" ? "Todos" : canaisDe(r) ? canais.filter((c) => canaisDe(r)!.includes(c.id)).map((c) => c.name).join(", ") || "Nenhum" : "Por departamento"}</td>
                <td>{r.active ? "Ativo" : "Desativado"}</td>
                <td><button onClick={() => editar(r)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="modal-bg" onClick={() => setDraft(null)}>
          <div className="modal eq-modal" onClick={(e) => e.stopPropagation()}>
            <div className="eq-head">
              <div>
                <strong>{draft.id ? `Editar ${draft.name}` : "Novo atendente"}</strong>
                <small className="muted">{draft.id ? draft.email : "Preencha os dados de acesso e escolha o que ele pode fazer."}</small>
              </div>
              <button className="eq-x" onClick={() => setDraft(null)} aria-label="Fechar">✕</button>
            </div>

            <div className="eq-body">
              <section className="eq-sec">
                <h3>1. Dados de acesso</h3>
                <div className="eq-grid">
                  <label>
                    Nome
                    <input autoFocus placeholder="Ex.: Maria Souza" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </label>
                  {!draft.id && (
                    <label>
                      E-mail (usado para entrar)
                      <input type="email" placeholder="maria@empresa.com" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                    </label>
                  )}
                  <label className="eq-full">
                    {draft.id ? "Nova senha (deixe em branco para manter a atual)" : "Senha inicial"}
                    <div className="eq-senha">
                      <input type="text" autoComplete="new-password" placeholder="Mínimo 8 caracteres" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
                      <button type="button" onClick={() => setDraft({ ...draft, password: gerarSenha() })}>Gerar senha</button>
                    </div>
                    {senhaCurta && <small className="eq-aviso">A senha precisa ter pelo menos 8 caracteres.</small>}
                  </label>
                </div>
              </section>

              <section className="eq-sec">
                <h3>2. Tipo de acesso</h3>
                <div className="eq-papeis">
                  {(
                    [
                      ["agent", "Atendente", "Só faz o que você marcar abaixo"],
                      ["admin", "Administrador", "Pode tudo e gerencia a equipe"],
                    ] as const
                  ).map(([v, t, d]) => (
                    <label key={v} className={`eq-papel${draft.role === v ? " on" : ""}`}>
                      <input type="radio" name="papel" checked={draft.role === v} disabled={draft.id === me?.id} onChange={() => setDraft({ ...draft, role: v })} />
                      <span><b>{t}</b><small className="muted">{d}</small></span>
                    </label>
                  ))}
                </div>
              </section>

              {draft.role === "agent" && (
                <section className="eq-sec">
                  <div className="eq-sec-h">
                    <h3>3. O que ele pode fazer</h3>
                    <button type="button" className="eq-link" onClick={() => setDraft({ ...draft, permissions: Object.fromEntries(perms.map((p) => [p.key, !todasMarcadas])) })}>
                      {todasMarcadas ? "Desmarcar todas" : "Marcar todas"}
                    </button>
                  </div>
                  <div className="eq-perms">
                    {perms.map((p) => (
                      <label key={p.key} className={`eq-perm${draft.permissions[p.key] ? " on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={!!draft.permissions[p.key]}
                          onChange={(e) => setDraft({ ...draft, permissions: { ...draft.permissions, [p.key]: e.target.checked } })}
                        />
                        <span><b>{p.label}</b><small className="muted">{p.desc}</small></span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {draft.role === "agent" && canais.length > 0 && (
                <section className="eq-sec">
                  <h3>4. Canais que ele vê</h3>
                  <small className="muted">
                    Marque o número/e-mail dele e, se quiser, os de outros atendentes. Ele vê as conversas desses canais e as que forem passadas para ele.
                    {draft.permissions.ver_todas ? " Com “Acesso total às conversas” ligado ele já vê todos os canais." : ""}
                  </small>
                  <div className="eq-canais">
                    {canais.map((c) => (
                      <label key={c.id} className={`eq-perm${draft.canais?.includes(c.id) ? " on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={!!draft.canais?.includes(c.id)}
                          onChange={(e) => {
                            const atual = draft.canais ?? [];
                            setDraft({ ...draft, canais: e.target.checked ? [...atual, c.id] : atual.filter((x) => x !== c.id) });
                          }}
                        />
                        <span><b>{icone(c)} {c.name}</b>{c.phone ? <small className="muted">{c.phone}</small> : null}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {draft.id && draft.id !== me?.id && (
                <section className="eq-sec">
                  <h3>Situação</h3>
                  <label className={`eq-perm${draft.active ? " on" : ""}`}>
                    <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                    <span><b>Acesso ativo</b><small className="muted">Desmarque para bloquear a entrada deste atendente sem apagar as conversas dele</small></span>
                  </label>
                </section>
              )}
            </div>

            <div className="eq-foot">
              {error && <div className="eq-erro">{error}</div>}
              <div className="eq-foot-btns">
                <button onClick={() => setDraft(null)}>Cancelar</button>
                <button className="primary" onClick={salvar} disabled={saving || !podeSalvar}>
                  {saving ? "Salvando…" : draft.id ? "Salvar alterações" : "Cadastrar atendente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
