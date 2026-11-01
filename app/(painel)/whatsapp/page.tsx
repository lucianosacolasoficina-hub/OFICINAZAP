"use client";

import { useEffect, useState } from "react";
import { api, formatPhone } from "@/lib/client";
import { InstagramSetup } from "@/components/InstagramSetup";
import { EmailSetup } from "@/components/EmailSetup";
import { GmailSetup } from "@/components/GmailSetup";

type Connection = {
  id: string;
  name: string;
  phone: string | null;
  department_id: string | null;
  connected_at: string | null;
  state: string;
};
type Department = { id: string; name: string };
type Data = { connections: Connection[]; departments: Department[]; max: number };

const STATE_LABEL: Record<string, string> = {
  open: "Conectado",
  connecting: "Aguardando leitura do QR Code",
  close: "Desconectado",
  missing: "Ainda não conectado",
  error: "Sem resposta do servidor do WhatsApp",
};

/**
 * Janela de conexão: QR Code que se renova sozinho a cada 30 segundos (o WhatsApp
 * recusa códigos vencidos) ou código de 8 letras pelo número do celular.
 * Confere a cada 3 segundos se o celular já conectou.
 */
function QrModal({ conn, onClose }: { conn: Connection; onClose: (connected: boolean) => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [modo, setModo] = useState<"qr" | "codigo">("qr");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [geradoEm, setGeradoEm] = useState(0);

  const generate = (comNumero?: string) => {
    setError("");
    if (!comNumero) setQr(null);
    api<{ state: string; qr?: string; pairingCode?: string }>(`/api/whatsapp/${conn.id}`, {
      method: "POST",
      body: JSON.stringify({ action: "connect", phone: comNumero }),
    })
      .then((r) => {
        if (r.state === "open") return onClose(true);
        setQr(r.qr ?? null);
        if (comNumero) setCode(r.pairingCode ?? null);
        if (comNumero && !r.pairingCode) setError("O servidor não devolveu o código. Confira o número com DDD ou use o QR Code.");
        setGeradoEm(Date.now());
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => generate(), [conn.id]);

  // Renova o QR Code a cada 30 segundos enquanto a janela está aberta (no modo QR).
  useEffect(() => {
    if (modo !== "qr") return;
    const t = setInterval(() => generate(), 30000);
    return () => clearInterval(t);
  }, [modo, conn.id]);

  useEffect(() => {
    if (!geradoEm) return;
    const t = setInterval(() => {
      api<Connection>(`/api/whatsapp/${conn.id}`).then((r) => r.state === "open" && onClose(true)).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [geradoEm]);

  return (
    <div className="modal-bg" onClick={() => onClose(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <strong>Conectar {conn.name}</strong>
        <div className="row" style={{ gap: 6, margin: "10px 0" }}>
          <button className={modo === "qr" ? "primary" : ""} onClick={() => { setModo("qr"); setCode(null); generate(); }}>QR Code</button>
          <button className={modo === "codigo" ? "primary" : ""} onClick={() => setModo("codigo")}>Código pelo número</button>
        </div>
        {modo === "qr" ? (
          <>
            <p className="muted">
              No celular desse número, abra o WhatsApp Business &gt; ⋮ ou Configurações &gt; Aparelhos conectados &gt; Conectar um aparelho e aponte a câmera.
              O código se renova sozinho a cada 30 segundos.
            </p>
            {error && <p style={{ color: "crimson" }}>{error}</p>}
            <div className="qr-box">
              {qr ? (
                <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code do WhatsApp" width={260} height={260} />
              ) : (
                !error && <span className="muted">Gerando QR Code...</span>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Sem câmera: digite o número do WhatsApp com DDD e toque em Gerar código. No celular, vá em Aparelhos conectados &gt; Conectar um aparelho &gt;
              <b> Conectar com número de telefone</b> e digite o código que aparecer aqui.
            </p>
            <div className="row" style={{ gap: 6 }}>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(77) 99999-0000" inputMode="tel" style={{ flex: 1 }} />
              <button className="primary" onClick={() => phone.replace(/\D/g, "").length >= 10 ? generate(phone) : setError("Digite o número com DDD.")}>Gerar código</button>
            </div>
            {error && <p style={{ color: "crimson" }}>{error}</p>}
            {code && (
              <div className="qr-box" style={{ fontSize: 34, fontWeight: 800, letterSpacing: 6, fontFamily: "monospace" }}>
                {code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code}
              </div>
            )}
          </>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          {modo === "qr" && <button onClick={() => generate()}>Gerar novo QR Code</button>}
          <button onClick={() => onClose(false)}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

/** Cadastro ou edição do nome e do departamento de um número. */
function EditModal({
  conn,
  departments,
  onClose,
}: {
  conn: Connection | null;
  departments: Department[];
  onClose: (saved?: Connection) => void;
}) {
  const [name, setName] = useState(conn?.name ?? "");
  const [departmentId, setDepartmentId] = useState(conn?.department_id ?? "");
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = JSON.stringify({ name, department_id: departmentId || null });
      const saved = conn
        ? await api<Connection>(`/api/whatsapp/${conn.id}`, { method: "PATCH", body })
        : await api<Connection>("/api/whatsapp", { method: "POST", body });
      onClose(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro");
    }
  }

  return (
    <div className="modal-bg" onClick={() => onClose()}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <strong>{conn ? "Editar número" : "Conectar novo número"}</strong>
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Bia, Vendas" required autoFocus />
        </label>
        <label>
          Departamento
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Nenhum</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <p className="muted">As conversas que chegarem por este número entram nesse departamento.</p>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={() => onClose()}>Cancelar</button>
          <button className="primary">{conn ? "Salvar" : "Continuar para o QR Code"}</button>
        </div>
      </form>
    </div>
  );
}

function ConnectionCard({
  conn,
  department,
  onQr,
  onEdit,
  onChanged,
}: {
  conn: Connection;
  department?: string;
  onQr: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const connected = conn.state === "open";
  const [hist, setHist] = useState<{ status: string; chats?: number; feitos?: number; conversas?: number; mensagens?: number; erro?: string } | null>(null);
  const [dias, setDias] = useState(30);

  // Andamento de "Puxar conversas antigas" (atualiza enquanto estiver rodando).
  useEffect(() => {
    let vivo = true;
    const ler = () => api<typeof hist>(`/api/whatsapp/${conn.id}/historico`).then((h) => vivo && setHist(h)).catch(() => {});
    ler();
    const t = setInterval(() => hist?.status === "rodando" && ler(), 4000);
    return () => { vivo = false; clearInterval(t); };
  }, [conn.id, hist?.status]);

  async function puxar() {
    const r = await api<{ historicoCompleto: boolean }>(`/api/whatsapp/${conn.id}/historico`, { method: "POST", body: JSON.stringify({ dias }) }).catch((e) => { alert(e.message); return null; });
    if (r) setHist({ status: "rodando", chats: 0, feitos: 0, conversas: 0, mensagens: 0 });
  }

  async function logout() {
    setMenu(false);
    if (!confirm(`Desconectar o WhatsApp de "${conn.name}"? Para voltar será preciso ler o QR Code de novo.`)) return;
    await api(`/api/whatsapp/${conn.id}`, { method: "POST", body: JSON.stringify({ action: "logout" }) }).catch((e) => alert(e.message));
    onChanged();
  }

  async function remove() {
    setMenu(false);
    if (!confirm(`Excluir "${conn.name}"? O número é desconectado e sai da lista. As conversas antigas continuam no sistema.`)) return;
    await api(`/api/whatsapp/${conn.id}`, { method: "DELETE" }).catch((e) => alert(e.message));
    onChanged();
  }

  return (
    <div className="wa-card">
      <div className={`wa-avatar ${connected ? "on" : ""}`}>👤</div>
      <div className="wa-info">
        <strong>{conn.name}</strong>
        <div className="muted">
          {conn.phone ? formatPhone(conn.phone) : "Sem número"}
          {department && <span className="tag" style={{ marginLeft: 8 }}>{department}</span>}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {connected && conn.connected_at
            ? `Conectado em ${new Date(conn.connected_at).toLocaleDateString("pt-BR")}`
            : STATE_LABEL[conn.state] ?? conn.state}
        </div>
        {!connected && (
          <button className="primary" style={{ marginTop: 6 }} onClick={onQr}>Ler QR Code</button>
        )}
        {connected && (
          <div className="wa-hist">
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))} disabled={hist?.status === "rodando"} title="Até quantos dias para trás">
              <option value={7}>7 dias</option>
              <option value={30}>30 dias</option>
              <option value={90}>90 dias</option>
              <option value={365}>1 ano</option>
              <option value={3650}>Tudo</option>
            </select>
            <button onClick={puxar} disabled={hist?.status === "rodando"}>⬇ Puxar conversas antigas</button>
            {hist?.status === "rodando" && (
              <button onClick={() => api(`/api/whatsapp/${conn.id}/historico`, { method: "POST", body: JSON.stringify({ parar: true }) }).catch((e) => alert(e.message))}>⏹ Parar</button>
            )}
            {hist && hist.status !== "nunca" && (
              <div className="muted" style={{ fontSize: 12.5 }}>
                {hist.status === "rodando"
                  ? `Puxando… ${hist.feitos ?? 0} de ${hist.chats ?? "?"} conversas · ${hist.mensagens ?? 0} mensagens`
                  : hist.status === "parado" || hist.status === "parar"
                    ? `Parado em ${hist.feitos ?? 0} de ${hist.chats ?? "?"} conversas · ${hist.mensagens ?? 0} mensagens trazidas.`
                    : hist.status === "erro"
                    ? `Erro ao puxar: ${hist.erro}`
                    : `Última vez: ${hist.chats ?? 0} conversas encontradas, ${hist.conversas ?? 0} novas, ${hist.mensagens ?? 0} mensagens trazidas.${hist.erro ? " ⚠ " + hist.erro : ""}`}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="wa-menu">
        <button onClick={() => setMenu(!menu)} aria-label="Opções">⋮</button>
        {menu && (
          <div className="wa-pop" onMouseLeave={() => setMenu(false)}>
            <div onClick={() => { setMenu(false); onEdit(); }}>Editar nome e departamento</div>
            <div onClick={() => { setMenu(false); onQr(); }}>{connected ? "Atualizar ligação com o sistema" : "Ler QR Code"}</div>
            {connected && (
              <div
                onClick={async () => {
                  setMenu(false);
                  const r = await api<{ state: string }>(`/api/whatsapp/${conn.id}`, { method: "POST", body: JSON.stringify({ action: "restart" }) }).catch((e) => { alert(e.message); return null; });
                  if (r) alert(r.state === "open" ? "Conexão reiniciada. As mensagens novas voltam a chegar em instantes." : "Conexão reiniciada, mas o número ainda não voltou. Se continuar assim, leia o QR Code de novo.");
                }}
                title="Use quando o número aparece conectado mas as mensagens novas não chegam"
              >🔄 Reiniciar conexão (mensagens não chegam)</div>
            )}
            {connected && <div onClick={logout}>Desconectar</div>}
            <div className="danger" onClick={remove}>Excluir</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WhatsAppPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [qrFor, setQrFor] = useState<Connection | null>(null);
  const [editing, setEditing] = useState<Connection | "new" | null>(null);

  const load = () =>
    api<Data>("/api/whatsapp")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  if (!data) return <div className="page">{error ? <span style={{ color: "crimson" }}>{error}</span> : "Carregando..."}</div>;

  const deptName = (id: string | null) => data.departments.find((d) => d.id === id)?.name;
  const term = search.trim().toLowerCase();
  const list = data.connections.filter(
    (c) =>
      !term ||
      [c.name, c.phone ?? "", c.phone ? formatPhone(c.phone) : "", deptName(c.department_id) ?? ""].some((v) =>
        v.toLowerCase().includes(term),
      ),
  );
  const full = data.connections.length >= data.max;

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>WhatsApp QR Code</h1>
          <p className="muted" style={{ marginTop: 0 }}>Conecte os números da empresa via QR Code para atender pelo OficinaZap.</p>
        </div>
        <button className="primary" disabled={full} onClick={() => setEditing("new")}>+ Conectar novo</button>
      </div>

      <div className="row" style={{ justifyContent: "space-between", margin: "8px 0 16px" }}>
        <input style={{ maxWidth: 260 }} placeholder="Pesquisar..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <span style={{ color: full ? "crimson" : "var(--muted)" }}>
          Em uso {data.connections.length} de {data.max} números.
        </span>
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <InstagramSetup />
      <GmailSetup />
      <EmailSetup />

      <div className="wa-grid">
        {list.map((c) => (
          <ConnectionCard
            key={c.id}
            conn={c}
            department={deptName(c.department_id)}
            onQr={() => setQrFor(c)}
            onEdit={() => setEditing(c)}
            onChanged={load}
          />
        ))}
        {list.length === 0 && <p className="muted">{term ? "Nenhum número encontrado." : "Nenhum número conectado ainda."}</p>}
      </div>

      {editing && (
        <EditModal
          conn={editing === "new" ? null : editing}
          departments={data.departments}
          onClose={(saved) => {
            const isNew = editing === "new";
            setEditing(null);
            if (!saved) return;
            load();
            // Número novo: abre direto o QR Code.
            if (isNew) setQrFor({ ...saved, state: "missing" });
          }}
        />
      )}
      {qrFor && (
        <QrModal
          conn={qrFor}
          onClose={() => {
            setQrFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}
