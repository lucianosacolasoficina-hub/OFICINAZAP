"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

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
