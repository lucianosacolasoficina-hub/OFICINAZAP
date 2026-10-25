"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

const WA_STATE: Record<string, string> = {
  open: "Conectado",
  connecting: "Aguardando leitura do QR Code",
  close: "Desconectado",
  missing: "Ainda não conectado",
};

function WhatsAppCard() {
  const [state, setState] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () =>
    api<{ state: string }>("/api/whatsapp")
      .then((r) => {
        setState(r.state);
        if (r.state === "open") setQr(null);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, []);

  // Enquanto o QR Code está na tela, confere a cada 3 segundos se o celular já conectou.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [qr]);

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ state: string; qr?: string }>("/api/whatsapp", { method: "POST" });
      setState(r.state);
      setQr(r.qr ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <strong>WhatsApp</strong>
      <p className="muted">
        Situação: {state ? WA_STATE[state] ?? state : "verificando..."}
        {error && <span style={{ color: "crimson" }}> ({error})</span>}
      </p>
      {state !== "open" && (
        <button className="primary" onClick={connect} disabled={busy}>
          {busy ? "Gerando QR Code..." : qr ? "Gerar novo QR Code" : "Conectar WhatsApp"}
        </button>
      )}
      {state === "open" && (
        <button onClick={connect} disabled={busy}>Atualizar ligação com o sistema</button>
      )}
      {qr && (
        <div style={{ marginTop: 12 }}>
          <p className="muted">
            No celular, abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho e aponte a câmera para o código.
          </p>
          <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code do WhatsApp" width={260} height={260} />
        </div>
      )}
    </div>
  );
}

function BlingCard() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const load = () => api<{ configured: boolean; connected: boolean }>("/api/bling").then(setStatus).catch((e) => setNotice(e.message));

  useEffect(() => {
    load();
    const result = new URLSearchParams(window.location.search).get("bling");
    if (result === "ok") setNotice("Bling conectado com sucesso.");
    if (result === "erro") setNotice("Não foi possível conectar ao Bling. Confira as chaves e tente de novo.");
  }, []);

  async function saveKeys(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/bling", { method: "PUT", body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }) });
      // Chaves salvas: segue direto para o login do Bling.
      window.location.href = "/api/bling/connect";
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "erro");
    }
  }

  async function disconnect() {
    if (!confirm("Desconectar o Bling? Os pedidos deixam de ser enviados.")) return;
    await api("/api/bling", { method: "DELETE" });
    setStatus((s) => s && { ...s, connected: false });
    setNotice("");
  }

  const showForm = status && (editing || !status.configured);

  return (
    <div className="card">
      <strong>Bling (sistema de gestão)</strong>
      <p className="muted">
        Situação: {!status ? "verificando..." : status.connected ? "Conectado" : "Não conectado"}.
        {" "}Quando um card do funil chega em &quot;Pedido fechado&quot;, o cliente e o pedido de venda são criados no Bling.
        {notice && <span style={{ display: "block", color: notice.includes("sucesso") ? "var(--brand)" : "crimson" }}>{notice}</span>}
      </p>
      {showForm && (
        <form onSubmit={saveKeys}>
          <p className="muted">
            Cole aqui as chaves do aplicativo que você criou no Bling (Central de Extensões &gt; Área do Integrador &gt; seu app &gt; Informações do App).
          </p>
          <label>Client Id<input value={clientId} onChange={(e) => setClientId(e.target.value)} required autoComplete="off" /></label>
          <label>Client Secret<input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required autoComplete="off" /></label>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary">Salvar e conectar ao Bling</button>
            {editing && <button type="button" onClick={() => setEditing(false)}>Cancelar</button>}
          </div>
        </form>
      )}
      {status?.configured && !editing && (
        <div className="row">
          <a href="/api/bling/connect">
            <button className={status.connected ? "" : "primary"}>{status.connected ? "Reconectar" : "Conectar ao Bling"}</button>
          </a>
          <button onClick={() => setEditing(true)}>Trocar chaves</button>
          {status.connected && <button className="danger" onClick={disconnect}>Desconectar</button>}
        </div>
      )}
    </div>
  );
}

type Settings = { bot_enabled: boolean; knowledge_base: string };
type QuickReply = { id: string; shortcut: string; body: string };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");

  const loadReplies = () => api<QuickReply[]>("/api/quick-replies").then(setReplies);

  useEffect(() => {
    api<Settings>("/api/settings").then(setSettings).catch(console.error);
    loadReplies().catch(console.error);
  }, []);

  async function save(patch: Partial<Settings>) {
    const next = { ...settings!, ...patch };
    setSettings(next);
    await api("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function addReply(e: React.FormEvent) {
    e.preventDefault();
    await api("/api/quick-replies", { method: "POST", body: JSON.stringify({ shortcut, body }) });
    setShortcut("");
    setBody("");
    await loadReplies();
  }

  async function removeReply(id: string) {
    await api(`/api/quick-replies/${id}`, { method: "DELETE" });
    await loadReplies();
  }

  if (!settings) return <div className="page">Carregando...</div>;

  return (
    <div className="page">
      <h1>Configurações {saved && <span className="tag">salvo</span>}</h1>

      <WhatsAppCard />

      <BlingCard />

      <div className="card">
        <label className="row" style={{ gap: 10 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={settings.bot_enabled}
            onChange={(e) => save({ bot_enabled: e.target.checked })}
          />
          <span>
            <strong>IA atendendo novas conversas</strong>
            <div className="muted">Desligado, toda conversa nova vai direto para a fila de atendimento humano.</div>
          </span>
        </label>
      </div>

      <div className="card">
        <strong>Informações da empresa para a IA</strong>
        <p className="muted">
          Tudo o que a IA pode usar para responder: produtos, tamanhos, pedido mínimo, prazos, pagamento, frete,
          horários. Ela não inventa nada que não esteja aqui.
        </p>
        <textarea
          rows={16}
          value={settings.knowledge_base}
          onChange={(e) => setSettings({ ...settings, knowledge_base: e.target.value })}
        />
        <div style={{ marginTop: 8 }}>
          <button className="primary" onClick={() => save({ knowledge_base: settings.knowledge_base })}>Salvar</button>
        </div>
      </div>

      <div className="card">
        <strong>Respostas rápidas</strong>
        <p className="muted">No chat, digite / seguido do atalho para inserir o texto.</p>
        <form onSubmit={addReply} className="row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
          <input style={{ width: 160 }} placeholder="atalho (ex.: pix)" value={shortcut} onChange={(e) => setShortcut(e.target.value)} required />
          <textarea rows={2} placeholder="Texto da resposta" value={body} onChange={(e) => setBody(e.target.value)} required />
          <button className="primary">Adicionar</button>
        </form>
        <table>
          <tbody>
            {replies.map((r) => (
              <tr key={r.id}>
                <td style={{ width: 140 }}><strong>/{r.shortcut}</strong></td>
                <td style={{ whiteSpace: "pre-wrap" }}>{r.body}</td>
                <td style={{ width: 90 }}><button className="danger" onClick={() => removeReply(r.id)}>Excluir</button></td>
              </tr>
            ))}
            {replies.length === 0 && <tr><td className="muted">Nenhuma resposta rápida ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
