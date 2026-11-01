"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useMe } from "@/lib/useMe";

type Imap = { address: string; last_sync: string | null; last_error: string | null };
type Conta = { id: string; name: string; connected_at: string | null; department_id: string | null; imap: Imap | Imap[] | null };
type Dep = { id: string; name: string };
type GCfg = { client_id: string | null; tem_chave: boolean; redirect_uri: string; origem: string };

const AVISOS: Record<string, string> = {
  ok: "✅ Gmail conectado! Os e-mails dos últimos 30 dias começam a chegar nas Conversas em alguns minutos.",
  cancelado: "A autorização foi cancelada no Google.",
  expirou: "A autorização demorou demais. Clique em Conectar com Google de novo.",
  "sem-app": "O administrador ainda precisa terminar a configuração do Google (abaixo).",
  "sem-permissao": "Seu usuário não pode conectar e-mail.",
};

/** Gmail de cada colaborador, ligado por senha de app do Google (sem projeto e sem cartão). */
export function GmailSetup() {
  const me = useMe();
  const [contas, setContas] = useState<Conta[]>([]);
  const [deps, setDeps] = useState<Dep[]>([]);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [dep, setDep] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [guia, setGuia] = useState(false);
  const [gcfg, setGcfg] = useState<GCfg | null>(null);
  const [gId, setGId] = useState("");
  const [gSecret, setGSecret] = useState("");
  const [gGuia, setGGuia] = useState(false);

  const load = () =>
    api<{ contas: Conta[] }>("/api/email/config")
      .then((c) => setContas(c.contas.filter((x) => (Array.isArray(x.imap) ? x.imap.length : x.imap))))
      .catch(() => {});
  useEffect(() => {
    load();
    api<{ departments: Dep[] }>("/api/departments").then((d) => setDeps(d.departments)).catch(() => {});
    api<GCfg>("/api/gmail/config").then((c) => { setGcfg(c); setGId(c.client_id ?? ""); }).catch(() => {});
    const q = new URLSearchParams(window.location.search);
    const g = q.get("gmail");
    if (g) {
      setAviso(g === "erro" ? `⚠ Não deu para conectar: ${q.get("msg") ?? "erro desconhecido"}` : AVISOS[g] ?? "");
      window.history.replaceState(null, "", window.location.pathname);
    }
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const admin = me?.role === "admin";
  const googlePronto = !!gcfg?.client_id && gcfg.tem_chave;

  async function salvarGoogle() {
    setSalvando(true);
    try {
      await api("/api/gmail/config", { method: "PUT", body: JSON.stringify({ client_id: gId, ...(gSecret ? { client_secret: gSecret } : {}) }) });
      setGSecret("");
      const c = await api<GCfg>("/api/gmail/config");
      setGcfg(c);
      setAviso("Dados do Google salvos.");
    } catch (e) {
      setAviso(`⚠ ${(e as Error).message}`);
    } finally {
      setSalvando(false);
    }
  }

  async function conectar() {
    setSalvando(true);
    setAviso("");
    try {
      await api("/api/email/imap", { method: "POST", body: JSON.stringify({ address: email, password: senha, nome, department_id: dep || null }) });
      setSenha("");
      setEmail("");
      setNome("");
      setAviso("✅ E-mail conectado! Os e-mails dos últimos 30 dias começam a chegar nas Conversas em alguns minutos.");
      load();
    } catch (e) {
      setAviso(`⚠ ${(e as Error).message}`);
    } finally {
      setSalvando(false);
    }
  }

  async function desconectar(id: string) {
    if (!confirm("Desconectar este e-mail? Os e-mails já trazidos continuam guardados, mas os novos param de chegar.")) return;
    await api(`/api/email/${id}`, { method: "DELETE" }).catch((e) => alert(e.message));
    load();
  }

  return (
    <section className="ig-box mail-box">
      <div>
        <h2 style={{ margin: 0 }}>📨 Gmail da equipe</h2>
        <p className="muted" style={{ margin: "2px 0 0" }}>
          Cada colaborador clica em <b>Conectar com Google</b>, escolhe o Gmail dele e permite. Os e-mails chegam e são respondidos aqui, nas Conversas, pela conta de quem recebeu.
        </p>
      </div>
      {googlePronto && (
        <a className="ig-btn mail-btn" href="/api/gmail/connect" style={{ alignSelf: "flex-start" }}>
          Conectar com Google
        </a>
      )}
      {aviso && <p className="ig-aviso">{aviso}</p>}

      {contas.length > 0 && (
        <div className="ig-contas">
          {contas.map((c) => {
            const i = Array.isArray(c.imap) ? c.imap[0] : c.imap;
            return (
              <div key={c.id} className="ig-conta">
                <b>{i?.address ?? c.name}</b>
                {c.name !== `E-mail ${i?.address}` && <span className="muted">{c.name.replace(/^E-mail /, "")}</span>}
                <span className={c.connected_at ? "ok" : "off"}>{c.connected_at ? "conectado" : "desconectado"}</span>
                {c.department_id && <span className="muted">{deps.find((d) => d.id === c.department_id)?.name}</span>}
                {i?.last_sync && <span className="muted">última busca {new Date(i.last_sync).toLocaleTimeString("pt-BR").slice(0, 5)}</span>}
                {i?.last_error && <span className="off">⚠ {i.last_error}</span>}
                {admin && c.connected_at && <button onClick={() => desconectar(c.id)}>Desconectar</button>}
              </div>
            );
          })}
        </div>
      )}

      {admin && !googlePronto && gcfg && (
        <div className="ig-guia">
          <p style={{ margin: "0 0 6px" }}><b>Configuração do Google (uma vez só, pelo administrador):</b></p>
          <div className="ig-campos">
            <span>Origem JavaScript autorizada:</span> <code>{gcfg.origem}</code>
            <span>URI de redirecionamento autorizado:</span> <code>{gcfg.redirect_uri}</code>
          </div>
          <div className="ig-form">
            <label>ID do cliente<input value={gId} onChange={(e) => setGId(e.target.value)} placeholder="....apps.googleusercontent.com" autoComplete="off" /></label>
            <label>Chave secreta do cliente<input type="text" className="segredo" name="segredo-app" value={gSecret} onChange={(e) => setGSecret(e.target.value)} placeholder={gcfg.tem_chave ? "já guardada (preencha só para trocar)" : "GOCSPX-..."} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-form-type="other" /></label>
            <button className="primary" disabled={salvando} onClick={salvarGoogle}>{salvando ? "Salvando…" : "Salvar dados do Google"}</button>
          </div>
        </div>
      )}
      {admin && googlePronto && (
        <button className="ig-link" onClick={() => setGGuia(!gGuia)}>{gGuia ? "Esconder dados do Google" : "Dados do app do Google"}</button>
      )}
      {admin && googlePronto && gGuia && gcfg && (
        <div className="ig-guia">
          <div className="ig-form">
            <label>ID do cliente<input value={gId} onChange={(e) => setGId(e.target.value)} autoComplete="off" /></label>
            <label>Chave secreta do cliente<input type="text" className="segredo" name="segredo-app" value={gSecret} onChange={(e) => setGSecret(e.target.value)} placeholder="já guardada (preencha só para trocar)" autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-form-type="other" /></label>
            <button className="primary" disabled={salvando} onClick={salvarGoogle}>{salvando ? "Salvando…" : "Salvar dados do Google"}</button>
          </div>
        </div>
      )}

      {admin && (
        <>
          <button className="ig-link" onClick={() => setGuia(!guia)}>{guia ? "Esconder" : "Outro jeito: ligar com senha de app"}</button>
          {guia && (
            <div className="ig-guia">
              <p style={{ margin: "0 0 6px" }}><b>A pessoa dona do Gmail faz isto (2 minutos):</b></p>
              <ol>
                <li>Entre em <a href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noopener">Verificação em duas etapas</a> e deixe <b>ativada</b> (o Google exige para a senha de app).</li>
                <li>Abra <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>, escreva o nome <b>OficinaZap</b> e clique em <b>Criar</b>.</li>
                <li>Copie a senha de <b>16 letras</b> que aparecer e cole abaixo, junto com o e-mail.</li>
              </ol>
              <div className="ig-form">
                <label>E-mail<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@gmail.com" inputMode="email" autoComplete="off" /></label>
                <label>Senha de app (16 letras)<input type="text" className="segredo" name="segredo-app" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="abcd efgh ijkl mnop" autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-form-type="other" /></label>
                <label>Nome de quem usa (opcional)<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Bia" /></label>
                {deps.length > 0 && (
                  <label>Departamento (opcional)
                    <select value={dep} onChange={(e) => setDep(e.target.value)}>
                      <option value="">— nenhum —</option>
                      {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </label>
                )}
                <button className="primary" disabled={salvando || !email || !senha} onClick={conectar}>{salvando ? "Conferindo…" : "Conectar Gmail"}</button>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>A senha de app fica guardada só no servidor e não aparece de novo. Ela não é a senha do Gmail e pode ser apagada pelo Google a qualquer momento.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
