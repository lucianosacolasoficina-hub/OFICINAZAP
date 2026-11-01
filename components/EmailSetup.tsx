"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useMe } from "@/lib/useMe";

type Tok = { address: string; last_sync: string | null; last_error: string | null };
type Cfg = {
  client_id: string | null;
  tem_chave: boolean;
  tenant: string;
  redirect_uri: string;
  contas: { id: string; name: string; connected_at: string | null; tok: Tok | Tok[] | null; imap?: unknown }[];
};

const AVISOS: Record<string, string> = {
  ok: "✅ Outlook conectado! Os e-mails dos últimos 30 dias estão chegando nas Conversas (aba do e-mail).",
  cancelado: "A autorização foi cancelada na Microsoft.",
  expirou: "A autorização demorou demais. Clique em Conectar Outlook de novo.",
  "sem-app": "Preencha o ID do aplicativo e o segredo antes de conectar.",
  "sem-permissao": "Só o administrador pode conectar o e-mail.",
};

function Copiar({ v }: { v: string }) {
  const [ok, setOk] = useState(false);
  return (
    <span className="ig-copy">
      <code>{v}</code>
      <button type="button" onClick={() => navigator.clipboard?.writeText(v).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {})}>{ok ? "Copiado" : "Copiar"}</button>
    </span>
  );
}

/** Ligação do e-mail Outlook pessoal pela API oficial da Microsoft. */
export function EmailSetup() {
  const me = useMe();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [tenant, setTenant] = useState("consumers");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [guia, setGuia] = useState(false);

  const load = () => api<Cfg>("/api/email/config").then((c) => { setCfg(c); setClientId(c.client_id ?? ""); setTenant(c.tenant || "consumers"); }).catch(() => {});
  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    const m = q.get("mail");
    if (m) {
      setAviso(m === "erro" ? `⚠ Não deu para conectar: ${q.get("msg") ?? "erro desconhecido"}` : AVISOS[m] ?? "");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (!cfg) return null;
  const admin = me?.role === "admin";
  const pronto = !!cfg.client_id; // o segredo é opcional (sem ele, o app usa PKCE como cliente público)
  // Só as contas do Outlook (o Gmail aparece no quadro "Gmail da equipe").
  const contas = cfg.contas
    .filter((c) => !(Array.isArray(c.imap) ? c.imap.length : c.imap))
    .map((c) => ({ ...c, tok: Array.isArray(c.tok) ? c.tok[0] : c.tok }));

  async function salvar() {
    setSalvando(true);
    try {
      await api("/api/email/config", { method: "PUT", body: JSON.stringify({ client_id: clientId, tenant, ...(secret ? { client_secret: secret } : {}) }) });
      setSecret("");
      await load();
      setAviso("Dados do aplicativo salvos.");
    } catch (e) {
      setAviso(`⚠ ${(e as Error).message}`);
    } finally {
      setSalvando(false);
    }
  }

  async function desconectar(id: string) {
    if (!confirm("Desconectar o e-mail? Os e-mails já trazidos continuam guardados, mas os novos param de chegar.")) return;
    await api(`/api/email/${id}`, { method: "DELETE" }).catch((e) => alert(e.message));
    load();
  }

  return (
    <section className="ig-box mail-box">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>📧 E-mail Outlook</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>Receba e responda e-mails na mesma tela das conversas (API oficial da Microsoft, sem custo).</p>
        </div>
        {admin && pronto && <a className="ig-btn mail-btn" href="/api/email/connect">Conectar Outlook</a>}
      </div>
      {aviso && <p className="ig-aviso">{aviso}</p>}

      {contas.length > 0 && (
        <div className="ig-contas">
          {contas.map((c) => (
            <div key={c.id} className="ig-conta">
              <b>{c.tok?.address ?? c.name}</b>
              <span className={c.connected_at ? "ok" : "off"}>{c.connected_at ? "conectado" : "desconectado"}</span>
              {c.tok?.last_sync && <span className="muted">última busca {new Date(c.tok.last_sync).toLocaleTimeString("pt-BR").slice(0, 5)}</span>}
              {c.tok?.last_error && <span className="off">⚠ {c.tok.last_error}</span>}
              {admin && c.connected_at && <button onClick={() => desconectar(c.id)}>Desconectar</button>}
            </div>
          ))}
        </div>
      )}

      {admin && (
        <>
          <button className="ig-link" onClick={() => setGuia(!guia)}>{guia ? "Esconder o passo a passo" : pronto ? "Ver passo a passo e dados do aplicativo" : "Passo a passo para ligar o Outlook"}</button>
          {(guia || !pronto) && (
            <div className="ig-guia">
              <ol>
                <li>Entre em <a href="https://portal.azure.com" target="_blank" rel="noopener">portal.azure.com</a> com a conta Microsoft. Se pedir, crie a conta gratuita do Azure (a Microsoft pode pedir cartão só para confirmar identidade, sem cobrança).</li>
                <li>Abra <b>Microsoft Entra ID → Registros de aplicativo → Novo registro</b>. Nome: <b>OficinaZap</b>. Tipos de conta: <b>Somente contas pessoais da Microsoft</b>.</li>
                <li>Em <b>URI de redirecionamento</b>, escolha <b>Web</b> e cole: <div className="ig-campos"><span>URI:</span> <Copiar v={cfg.redirect_uri} /></div></li>
                <li>Depois de criar, copie o <b>ID do aplicativo (cliente)</b>. Em <b>Certificados e segredos → Novo segredo do cliente</b>, crie um segredo e copie o <b>Valor</b>.</li>
                <li>Cole abaixo, salve e clique em <b>Conectar Outlook</b>. Entre na conta de e-mail e autorize.</li>
              </ol>
              <div className="ig-form">
                <label>ID do aplicativo (cliente)<input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label>
                <label>Valor do segredo do cliente<input type="text" className="segredo" name="segredo-app" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={cfg.tem_chave ? "já guardado (preencha só para trocar)" : "cole aqui"} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-form-type="other" /></label>
                <label>Tipo de conta
                  <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
                    <option value="consumers">Somente contas pessoais (Outlook/Hotmail)</option>
                    <option value="common">Pessoais e de empresas</option>
                  </select>
                </label>
                <button className="primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar dados do aplicativo"}</button>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>O segredo fica guardado só no servidor e não aparece de novo na tela.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
