"use client";

import { useEffect, useRef, useState } from "react";
import { api, formatPhone, formatTime } from "@/lib/client";
import type { Contact } from "@/lib/db";
import { parseGoogleContacts, type ParsedContact } from "@/lib/googleContacts";

type ImportResult = { created: number; updated: number; unchanged: number; invalid: number };

export default function ContactsPage() {
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [reload, setReload] = useState(0);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api<Contact[]>(`/api/contacts?q=${encodeURIComponent(q)}`).then(setContacts).catch(console.error);
    }, 250);
    return () => clearTimeout(t);
  }, [q, reload]);

  return (
    <div className="page">
      <h1>Contatos</h1>
      <div className="card" style={{ display: "flex", gap: 8 }}>
        <input placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" onClick={() => setShowImport((v) => !v)}>Importar do Google</button>
      </div>
      <GoogleSync onDone={() => setReload((n) => n + 1)} />
      {showImport && <ImportCard onDone={() => setReload((n) => n + 1)} />}
      <table>
        <thead>
          <tr><th>Nome</th><th>Telefone</th><th>Etiquetas</th><th>Desde</th></tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id}>
              <td>{c.name || <span className="muted">sem nome</span>}</td>
              <td>{formatPhone(c.phone)}</td>
              <td>{c.tags.map((t) => <span key={t} className="tag">{t}</span>)}</td>
              <td className="muted">{formatTime(c.created_at)}</td>
            </tr>
          ))}
          {contacts.length === 0 && (
            <tr><td colSpan={4} className="muted">Nenhum contato encontrado.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ImportCard({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedContact[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  async function pick(file: File | undefined) {
    setParsed(null); setResult(null); setError("");
    if (!file) return;
    const list = parseGoogleContacts(await file.text());
    if (list.length === 0) setError("Não achei contatos nesse arquivo. Confira se é o arquivo .csv exportado do Google Contatos.");
    else if (!list.some((c) => c.phones.length)) setError("O arquivo não tem nenhum telefone. Confira se é o arquivo .csv exportado do Google Contatos.");
    else setParsed(list);
  }

  async function run() {
    if (!parsed) return;
    setBusy(true); setError("");
    const total: ImportResult = { created: 0, updated: 0, unchanged: 0, invalid: 0 };
    try {
      for (let i = 0; i < parsed.length; i += 1000) {
        setProgress(`Importando ${Math.min(i + 1000, parsed.length)} de ${parsed.length}...`);
        const r = await api<ImportResult>("/api/contacts/import", {
          method: "POST",
          body: JSON.stringify({ contacts: parsed.slice(i, i + 1000) }),
        });
        for (const k of Object.keys(total) as (keyof ImportResult)[]) total[k] += r[k];
      }
      setResult(total);
      setParsed(null);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao importar");
    } finally {
      setBusy(false); setProgress("");
    }
  }

  const withPhone = parsed?.filter((c) => c.phones.length).length ?? 0;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Importar contatos do Google</h3>
      <ol className="muted" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Abra <a href="https://contacts.google.com" target="_blank" rel="noreferrer">contacts.google.com</a> com a sua conta do Google.</li>
        <li>No menu da esquerda, clique em <b>Exportar</b> (ou no ícone de seta para baixo, no topo da lista).</li>
        <li>Escolha <b>Google CSV</b> e clique em <b>Exportar</b>. O arquivo <b>contacts.csv</b> vai para a pasta Downloads.</li>
        <li>Clique abaixo em <b>Escolher arquivo</b> e selecione esse arquivo.</li>
      </ol>
      <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
      {parsed && (
        <p>
          Encontrei <b>{parsed.length}</b> contatos, <b>{withPhone}</b> com telefone.
          Contatos que já existem não serão duplicados.{" "}
          <button className="primary" disabled={busy} onClick={run}>{busy ? "Importando..." : `Importar ${withPhone} contatos`}</button>
        </p>
      )}
      {progress && <p className="muted">{progress}</p>}
      {result && (
        <p>
          Pronto! <b>{result.created}</b> contatos novos
          {result.updated > 0 && <>, <b>{result.updated}</b> atualizados</>}
          {result.unchanged > 0 && <>, <b>{result.unchanged}</b> já estavam aqui</>}
          {result.invalid > 0 && <span className="muted"> ({result.invalid} sem telefone válido foram ignorados)</span>}.
        </p>
      )}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

type GStatus = { conectado: boolean; conta: string | null; ultima: string | null; erro: string | null; ligados: number; stats: Record<string, number> | null };

// Ligação com o Google Contatos (nos dois sentidos): nomes do Google atualizam aqui e contatos novos daqui vão para o Google.
function GoogleSync({ onDone }: { onDone: () => void }) {
  const [st, setSt] = useState<GStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const ler = () => api<GStatus>("/api/google-contatos").then(setSt).catch(() => {});
  useEffect(() => {
    ler();
    const q = new URLSearchParams(window.location.search);
    const g = q.get("google");
    if (g === "ok") setMsg("Google Contatos ligado. A primeira sincronização está rodando: em alguns minutos os contatos aparecem nos dois lados.");
    else if (g === "sem-app") setMsg("Falta configurar o app do Google (o mesmo do Gmail) em Conexões.");
    else if (g === "sem-permissao") setMsg("Só o administrador pode ligar o Google Contatos.");
    else if (g) setMsg(`Não deu certo: ${q.get("msg") || g}`);
  }, []);
  async function sincronizar() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api<Record<string, number>>("/api/google-contatos", { method: "POST" });
      setMsg(`Pronto: ${r.criadosNoGoogle ?? 0} enviados ao Google, ${r.nomesAtualizados ?? 0} nomes atualizados do Google, ${r.nomesEnviados ?? 0} nomes alterados enviados.`);
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
      ler();
    }
  }
  if (!st) return null;
  return (
    <div className="card gsync">
      <div className="gsync-h">
        <b>🔄 Google Contatos</b>
        {st.conectado ? <span className="gsync-ok">ligado · {st.conta}</span> : <span className="muted">não ligado</span>}
      </div>
      {st.conectado ? (
        <>
          <p className="muted" style={{ margin: "6px 0" }}>
            Nos dois sentidos, a cada 15 minutos: o nome salvo no Google atualiza o contato aqui, e contato novo com nome no OficinaZap é salvo no Google (aparece no celular).
            {" "}{st.ligados} contatos ligados{st.ultima ? ` · última vez ${formatTime(st.ultima)}` : ""}.
          </p>
          {st.erro && <p style={{ color: "var(--danger)", margin: "6px 0" }}>Último erro: {st.erro}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="primary" disabled={busy} onClick={sincronizar}>{busy ? "Sincronizando…" : "Sincronizar agora"}</button>
            <a className="btn" href="/api/google-contatos/connect">Trocar a conta</a>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: "6px 0" }}>Liga os contatos do OficinaZap ao Google Contatos de lucianosacolasoficina@gmail.com, nos dois sentidos.</p>
          <a className="btn primary" href="/api/google-contatos/connect">Ligar ao Google Contatos</a>
        </>
      )}
      {msg && <p style={{ margin: "8px 0 0", fontWeight: 600 }}>{msg}</p>}
    </div>
  );
}
