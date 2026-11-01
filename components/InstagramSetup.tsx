"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useMe } from "@/lib/useMe";

type Cfg = {
  app_id: string | null;
  config_id: string | null;
  tem_chave: boolean;
  verify_token: string;
  webhook_url: string;
  redirect_uri: string;
  privacidade_url: string;
  exclusao_url: string;
  contas: { id: string; name: string; connected_at: string | null; tok: { username: string | null; expires_at: string | null } | { username: string | null; expires_at: string | null }[] | null }[];
};

const AVISOS: Record<string, string> = {
  ok: "✅ Instagram conectado! As mensagens do Direct já começam a chegar nas Conversas.",
  cancelado: "A autorização foi cancelada no Instagram.",
  expirou: "A autorização demorou demais. Clique em Conectar Instagram de novo.",
  "sem-app": "Preencha o App ID e a chave secreta do app antes de conectar.",
  "sem-permissao": "Só o administrador pode conectar o Instagram.",
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

/** Ligação do Instagram Direct pela API oficial da Meta. */
export function InstagramSetup() {
  const me = useMe();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [appId, setAppId] = useState("");
  const [configId, setConfigId] = useState("");
  const [secret, setSecret] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [guia, setGuia] = useState(false);

  const load = () => api<Cfg>("/api/instagram/config").then((c) => { setCfg(c); setAppId(c.app_id ?? ""); setConfigId(c.config_id ?? ""); }).catch(() => {});
  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    const ig = q.get("ig");
    if (ig) {
      setAviso(ig === "erro" ? `⚠ Não deu para conectar: ${q.get("msg") ?? "erro desconhecido"}` : AVISOS[ig] ?? "");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (!cfg) return null;
  const admin = me?.role === "admin";
  const pronto = !!cfg.app_id && cfg.tem_chave;
  const contas = cfg.contas.map((c) => ({ ...c, tok: Array.isArray(c.tok) ? c.tok[0] : c.tok }));

  async function salvar() {
    setSalvando(true);
    try {
      await api("/api/instagram/config", { method: "PUT", body: JSON.stringify({ app_id: appId, config_id: configId, ...(secret ? { app_secret: secret } : {}) }) });
      setSecret("");
      await load();
      setAviso("Dados do app salvos.");
    } catch (e) {
      setAviso(`⚠ ${(e as Error).message}`);
    } finally {
      setSalvando(false);
    }
  }

  async function desconectar(id: string) {
    if (!confirm("Desconectar o Instagram? As conversas continuam guardadas, mas as mensagens novas param de chegar.")) return;
    await api(`/api/instagram/${id}`, { method: "DELETE" }).catch((e) => alert(e.message));
    load();
  }

  return (
    <section className="ig-box">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>📸 Instagram Direct</h2>
          <p className="muted" style={{ margin: "2px 0 0" }}>Receba e responda as mensagens do Direct aqui no OficinaZap (API oficial da Meta, sem custo).</p>
        </div>
        {admin && pronto && <a className="ig-btn" href="/api/instagram/connect">Conectar Instagram</a>}
      </div>
      {aviso && <p className="ig-aviso">{aviso}</p>}

      {contas.length > 0 && (
        <div className="ig-contas">
          {contas.map((c) => (
            <div key={c.id} className="ig-conta">
              <b>{c.name}</b>
              <span className={c.connected_at ? "ok" : "off"}>{c.connected_at ? "conectado" : "desconectado"}</span>
              {c.tok?.expires_at && <span className="muted">autorização renovada sozinha · vence {new Date(c.tok.expires_at).toLocaleDateString("pt-BR")}</span>}
              {admin && c.connected_at && <button onClick={() => desconectar(c.id)}>Desconectar</button>}
            </div>
          ))}
        </div>
      )}

      {admin && (
        <>
          <button className="ig-link" onClick={() => setGuia(!guia)}>{guia ? "Esconder o passo a passo" : pronto ? "Ver passo a passo e dados do app" : "Passo a passo para ligar o Instagram"}</button>
          {(guia || !pronto) && (
            <div className="ig-guia">
              <ol>
                <li>O Instagram da empresa precisa ser <b>conta profissional</b> (comercial ou criador): no app do Instagram, Configurações → Tipo de conta e ferramentas.</li>
                <li>Entre em <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> com o seu Facebook e clique em <b>Criar app</b> → caso de uso <b>&quot;Gerenciar mensagens e conteúdo no Instagram&quot;</b> → tipo <b>Empresa</b>.</li>
                <li>No app, em <b>Configurações do app → Básico</b>, preencha:
                  <div className="ig-campos">
                    <span>URL da Política de Privacidade:</span> <Copiar v={cfg.privacidade_url} />
                    <span>URL de exclusão de dados:</span> <Copiar v={cfg.exclusao_url} />
                  </div>
                </li>
                <li>Em <b>Casos de uso → API do Instagram → API setup with Unified login</b>: crie a configuração sugerida e preencha:
                  <div className="ig-campos">
                    <span>URL de redirecionamento:</span> <Copiar v={cfg.redirect_uri} />
                    <span>Webhook – URL de callback:</span> <Copiar v={cfg.webhook_url} />
                    <span>Webhook – Token de verificação:</span> <Copiar v={cfg.verify_token} />
                  </div>
                  Ligue o campo de webhook <b>messages</b>. Copie o <b>ID do app</b>, a <b>Identificação da configuração</b> e a <b>Chave secreta do aplicativo</b> (em Configurações do app → Básico) e cole abaixo.
                </li>
                <li>Salve aqui e clique em <b>Conectar Instagram</b>. Entre na conta da empresa e autorize.</li>
              </ol>
              <div className="ig-form">
                <label>ID do app<input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="só números" inputMode="numeric" /></label>
                <label>Identificação da configuração<input value={configId} onChange={(e) => setConfigId(e.target.value)} placeholder="só números" inputMode="numeric" /></label>
                <label>Chave secreta do aplicativo<input type="text" className="segredo" name="segredo-app" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={cfg.tem_chave ? "já guardada (preencha só para trocar)" : "cole aqui"} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-form-type="other" /></label>
                <button className="primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar dados do app"}</button>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>A chave secreta fica guardada só no servidor e não aparece de novo na tela.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
