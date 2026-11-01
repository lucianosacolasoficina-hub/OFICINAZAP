"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

type Ped = {
  id: string; numero: string; etapa: string; entrada: string; entrega: string | null; atrasado: boolean;
  total: number; aberto: number; pagamento: string | null; representada: boolean; nfe: string | null;
  itens: string | null; os: { numero: string; etapa: string }[];
};
type Prop = { id: string; numero: string; data: string; situacao: string | null; total: number; itens: string | null };
type Cli = { id: string; nome: string | null; fantasia?: string | null; documento?: string | null; cidade?: string | null; uf?: string | null; telefone?: string | null };
type Resp = {
  ativo: boolean;
  site?: string;
  grupo?: boolean;
  vinculo?: { id: string; nome: string | null } | null;
  via?: "vinculo" | "telefone" | null;
  cliente?: Cli | null;
  pedidos?: Ped[];
  propostas?: Prop[];
  resumo?: { qtd: number; total: number; primeiro: string | null; ultimo: string | null; andamento: number };
  aReceber?: number;
  creditos?: number;
  atualizadoEm?: string | null;
};
type Achado = { id: string; nome: string | null; razao: string | null; documento: string | null; cidade: string | null; telefone: string | null; pedidos: number };

const brl = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dBR = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const FIM = ["Concluído", "Entregue"];

type Oc = { em: string; tipo: string; texto: string; por: string };
type OcResp = { numero: string; cliente: string | null; telefone: string | null; etapa: string | null; ocorrencias: Oc[] };
const OC_ICON: Record<string, string> = { os: "🧾", fat: "💰", etapa: "↻", nf: "📄", fin: "$", criada: "✚", origem: "↗", nota: "✎", entrega: "📦", contato: "☎", problema: "⚠", prazo: "⏱", pagamento: "$" };
const OC_TIPOS: [string, string][] = [["nota", "✎ Anotação"], ["contato", "☎ Contato com o cliente"], ["problema", "⚠ Problema"], ["prazo", "⏱ Prazo"], ["pagamento", "$ Pagamento"], ["entrega", "📦 Entrega"]];
const quando = (em: string) => (em ? `${dBR(em.slice(0, 10))} ${em.slice(11, 16)}` : "");
const quem = (por: string) => (por && !/^u_|^[0-9a-f-]{20,}$/i.test(por) ? por : "");
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Ocorrências de um pedido/proposta: lista, lançar nova, imprimir e mandar pelo WhatsApp. */
function Ocorrencias({ col, id, rotulo }: { col: "pedidos" | "orcamentos"; id: string; rotulo: string }) {
  const [d, setD] = useState<OcResp | null>(null);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState("nota");
  const [salvando, setSalvando] = useState(false);
  const [ocAberta, setOcAberta] = useState<string | null>(null);
  const carregar = () =>
    api<OcResp>(`/api/gestao/ocorrencias?col=${col}&id=${encodeURIComponent(id)}`)
      .then((r) => { setD(r); setErro(""); })
      .catch((e) => setErro((e as Error).message));
  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col, id]);

  async function lancar() {
    if (!texto.trim()) return;
    setSalvando(true);
    try {
      await api("/api/gestao/ocorrencias", { method: "POST", body: JSON.stringify({ col, id, texto, tipo }) });
      setTexto("");
      setTipo("nota");
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function textoWhats() {
    const l = (d?.ocorrencias ?? []).slice(0, 20).map((o) => `• ${quando(o.em)} — ${o.texto}`);
    return `*Ocorrências do ${rotulo}*${d?.cliente ? `\nCliente: ${d.cliente}` : ""}${d?.etapa ? `\nSituação: ${d.etapa}` : ""}\n\n${l.join("\n") || "Nenhuma ocorrência."}`;
  }

  function imprimir() {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const linhas = (d?.ocorrencias ?? [])
      .map((o) => `<tr><td>${escHtml(quando(o.em))}</td><td>${OC_ICON[o.tipo] ?? "•"}</td><td>${escHtml(o.texto)}</td><td>${escHtml(quem(o.por))}</td></tr>`)
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ocorrências - ${escHtml(rotulo)}</title>
<style>body{font-family:Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12.5px}th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}th{background:#f0f0f0}td:nth-child(1){white-space:nowrap}</style></head>
<body><h1>Sacolas Oficina — Ocorrências do ${escHtml(rotulo)}</h1>${d?.cliente ? `<p><b>Cliente:</b> ${escHtml(d.cliente)}</p>` : ""}${d?.etapa ? `<p><b>Situação:</b> ${escHtml(d.etapa)}</p>` : ""}<p><b>Emitido em:</b> ${new Date().toLocaleString("pt-BR")}</p>
<table><thead><tr><th>Data</th><th></th><th>Ocorrência</th><th>Por</th></tr></thead><tbody>${linhas || '<tr><td colspan="4">Nenhuma ocorrência.</td></tr>'}</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="hp-oc">
      <div className="hp-oc-form">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo da ocorrência">
          {OC_TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nova ocorrência (ex.: cliente pediu para adiantar a entrega)" />
        <button className="primary" disabled={salvando || !texto.trim()} onClick={lancar}>{salvando ? "Lançando…" : "＋ Lançar ocorrência"}</button>
      </div>
      <div className="hp-oc-acts">
        <button onClick={imprimir} disabled={!d}>🖨 Imprimir</button>
        <button onClick={() => rascunho(textoWhats())} disabled={!d}>💬 Enviar pelo WhatsApp</button>
      </div>
      {erro && <p className="hp-erro">⚠ {erro}</p>}
      {!d && !erro && <p className="muted hp-sm">Carregando ocorrências…</p>}
      {d && d.ocorrencias.length === 0 && <p className="muted hp-sm">Nenhuma ocorrência ainda.</p>}
      {d && d.ocorrencias.length > 0 && (
        <ul className="hp-oc-lista">
          {d.ocorrencias.slice(0, 80).map((o, i) => (
            <li key={i}>
              <span className="hp-oc-i">{OC_ICON[o.tipo] ?? "•"}</span>
              <span className="hp-oc-d">{quando(o.em)}</span>
              <span className="hp-oc-t">{o.texto}{quem(o.por) && <em> — {quem(o.por)}</em>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Coloca um texto na caixa de resposta da conversa (o atendente revisa e envia). */
export function rascunho(texto: string) {
  window.dispatchEvent(new CustomEvent("zap-rascunho", { detail: texto }));
}

export function HistoricoPedidos({ contactId, contactName, onClose }: { contactId: string; contactName: string; onClose: () => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<"pedidos" | "propostas">("pedidos");
  const [todos, setTodos] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [q, setQ] = useState("");
  const [achados, setAchados] = useState<Achado[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ocAberta, setOcAberta] = useState<string | null>(null);
  const seq = useRef(0);

  async function carregar() {
    const n = ++seq.current;
    setErro("");
    try {
      const r = await api<Resp>(`/api/gestao/historico?contact_id=${contactId}`);
      if (n === seq.current) setData(r);
    } catch (e) {
      if (n === seq.current) setErro((e as Error).message);
    }
  }

  useEffect(() => {
    setData(null);
    setBuscando(false);
    setQ("");
    setAchados(null);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  useEffect(() => {
    if (!buscando) return;
    const t = q.trim();
    if (t.length < 2) {
      setAchados(null);
      return;
    }
    const h = setTimeout(() => {
      api<{ clientes: Achado[] }>(`/api/gestao/clientes?q=${encodeURIComponent(t)}`)
        .then((r) => setAchados(r.clientes))
        .catch(() => setAchados([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q, buscando]);

  async function vincular(c: Achado | null) {
    setSalvando(true);
    try {
      await api("/api/gestao/vincular", { method: "POST", body: JSON.stringify({ contact_id: contactId, cliente_id: c?.id ?? null, cliente_nome: c?.nome ?? null }) });
      setBuscando(false);
      setQ("");
      setAchados(null);
      setData(null);
      await carregar();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function abrirBusca() {
    setBuscando(true);
    setQ(data?.cliente ? "" : contactName && !/^\+?\d[\d\s()-]+$/.test(contactName) ? contactName : "");
  }

  const site = data?.site || "https://sistema.sacolasoficina.com.br";
  const cli = data?.cliente;
  const pedidos = data?.pedidos ?? [];
  const propostas = data?.propostas ?? [];
  const lista = todos ? pedidos : pedidos.filter((p) => !FIM.includes(p.etapa));

  function textoStatus(p: Ped) {
    const nome = cli?.fantasia || cli?.nome || "";
    const prod = p.os.length ? p.os.map((o) => o.etapa).join(", ") : p.etapa;
    return `Olá${nome ? ", " + nome : ""}! Atualização do seu pedido nº ${p.numero}: está na etapa *${prod}*. Previsão de entrega: ${dBR(p.entrega)}. Qualquer dúvida, estou à disposição.`;
  }

  return (
    <aside className="side hp">
      <div className="hp-top">
        <h3>📦 Histórico do cliente</h3>
        <button className="hp-x" onClick={onClose} aria-label="Fechar histórico">×</button>
      </div>

      {erro && <p className="hp-erro">⚠ {erro} <button className="gz-link" onClick={carregar}>tentar de novo</button></p>}
      {!data && !erro && <p className="muted">Consultando o sistema de gestão…</p>}
      {data && !data.ativo && <p className="muted">A ligação com o sistema de gestão não está configurada.</p>}

      {data?.ativo && (
        <>
          {cli && !buscando ? (
            <div className="hp-cli">
              <b className="hp-nome">{cli.fantasia || cli.nome}</b>
              {cli.fantasia && cli.nome && cli.fantasia !== cli.nome && <span className="muted hp-sm">{cli.nome}</span>}
              <span className="hp-sm">
                {[cli.documento, [cli.cidade, cli.uf].filter(Boolean).join("/"), cli.telefone].filter(Boolean).join(" · ")}
              </span>
              <span className="hp-via">
                {data.via === "vinculo" ? "🔗 Vinculado a esta conversa" : "📞 Encontrado pelo telefone"}
                <button className="gz-link" onClick={abrirBusca}>trocar</button>
                {data.via === "vinculo" && <button className="gz-link" disabled={salvando} onClick={() => vincular(null)}>desvincular</button>}
              </span>
            </div>
          ) : !buscando ? (
            <div className="hp-vazio">
              <p>{data.grupo ? "Este é um grupo. Vincule a um cliente do sistema para ver os pedidos aqui." : "Não achei este telefone no cadastro de clientes do sistema."}</p>
              <button className="primary" onClick={abrirBusca}>🔗 Vincular a um cliente</button>
            </div>
          ) : null}

          {buscando && (
            <div className="hp-busca">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, CNPJ/CPF ou telefone do cliente" />
              {q.trim().length < 2 && <p className="muted hp-sm">Digite ao menos 2 letras.</p>}
              {achados?.length === 0 && <p className="muted hp-sm">Nenhum cliente encontrado.</p>}
              {achados?.map((c) => (
                <button key={c.id} className="hp-achado" disabled={salvando} onClick={() => vincular(c)}>
                  <b>{c.nome}</b>
                  <span className="hp-sm muted">{[c.documento, c.cidade, c.telefone].filter(Boolean).join(" · ")}</span>
                  <span className="hp-sm">{c.pedidos} pedido{c.pedidos === 1 ? "" : "s"}</span>
                </button>
              ))}
              <button className="gz-link" onClick={() => { setBuscando(false); setAchados(null); }}>cancelar</button>
            </div>
          )}

          {cli && !buscando && (
            <>
              <div className="hp-kpis">
                <div><small>Pedidos</small><b>{data.resumo?.qtd ?? pedidos.length}</b></div>
                <div><small>Total comprado</small><b>{brl(data.resumo?.total ?? 0)}</b></div>
                <div><small>Último pedido</small><b>{dBR(data.resumo?.ultimo)}</b></div>
                <div><small>Em andamento</small><b>{data.resumo?.andamento ?? 0}</b></div>
                {(data.aReceber ?? 0) > 0.009 && <div className="deb"><small>A receber</small><b>{brl(data.aReceber!)}</b></div>}
                {(data.creditos ?? 0) > 0.009 && <div className="cred"><small>Crédito</small><b>{brl(data.creditos!)}</b></div>}
              </div>

              <div className="hp-abas">
                <button className={aba === "pedidos" ? "on" : ""} onClick={() => setAba("pedidos")}>Pedidos ({pedidos.length})</button>
                <button className={aba === "propostas" ? "on" : ""} onClick={() => setAba("propostas")}>Propostas ({propostas.length})</button>
                {aba === "pedidos" && (
                  <label className="hp-sm hp-chk"><input type="checkbox" checked={!todos} onChange={(e) => setTodos(!e.target.checked)} /> só em andamento</label>
                )}
              </div>

              {aba === "pedidos" && (
                <div className="hp-lista">
                  {lista.length === 0 && <p className="muted">Nenhum pedido{todos ? "" : " em andamento"}.</p>}
                  {lista.map((p) => (
                    <div key={p.id} className={`hp-ped${p.atrasado ? " late" : ""}${FIM.includes(p.etapa) ? " fim" : ""}`}>
                      <div className="hp-l1">
                        <b>Pedido {p.numero}</b>
                        <span className="muted hp-sm">{dBR(p.entrada)}</span>
                        <b className="hp-val">{brl(p.total)}</b>
                      </div>
                      <div className="hp-l2">
                        <span className="hp-et">{p.etapa || "—"}</span>
                        {p.atrasado && <span className="gz-tag">atrasado</span>}
                        {p.representada && <span className="hp-tag">representada</span>}
                        {p.nfe && <span className="hp-tag">NF {p.nfe}</span>}
                      </div>
                      {p.os.length > 0 && <div className="hp-sm muted">Produção: {p.os.map((o) => `OS ${o.numero} · ${o.etapa}`).join(" | ")}</div>}
                      <div className="hp-sm muted">
                        Entrega {dBR(p.entrega)}
                        {p.aberto > 0.009 ? <> · <span className="hp-deb">falta receber {brl(p.aberto)}</span></> : p.pagamento === "pago" ? " · pago" : ""}
                      </div>
                      {p.itens && <div className="hp-sm hp-it" title={p.itens}>{p.itens}</div>}
                      <div className="hp-acts">
                        <button className={`hp-oc-btn${ocAberta === p.id ? " on" : ""}`} onClick={() => setOcAberta(ocAberta === p.id ? null : p.id)}>📋 Ocorrências</button>
                        <a href={`${site}/#ped=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener">Abrir no sistema ↗</a>
                        {!FIM.includes(p.etapa) && <button onClick={() => rascunho(textoStatus(p))}>💬 Status para o cliente</button>}
                      </div>
                      {ocAberta === p.id && <Ocorrencias col="pedidos" id={p.id} rotulo={`pedido nº ${p.numero}`} />}
                    </div>
                  ))}
                </div>
              )}

              {aba === "propostas" && (
                <div className="hp-lista">
                  {propostas.length === 0 && <p className="muted">Nenhuma proposta.</p>}
                  {propostas.map((o) => (
                    <div key={o.id} className="hp-ped">
                      <div className="hp-l1">
                        <b>Proposta {o.numero}</b>
                        <span className="muted hp-sm">{dBR(o.data)}</span>
                        <b className="hp-val">{brl(o.total)}</b>
                      </div>
                      {o.situacao && <div className="hp-l2"><span className="hp-et">{o.situacao}</span></div>}
                      {o.itens && <div className="hp-sm hp-it" title={o.itens}>{o.itens}</div>}
                      <div className="hp-acts">
                        <button className={`hp-oc-btn${ocAberta === o.id ? " on" : ""}`} onClick={() => setOcAberta(ocAberta === o.id ? null : o.id)}>📋 Ocorrências</button>
                        <a href={`${site}/#orc=${encodeURIComponent(o.id)}`} target="_blank" rel="noopener">Abrir no sistema ↗</a>
                      </div>
                      {ocAberta === o.id && <Ocorrencias col="orcamentos" id={o.id} rotulo={`orçamento nº ${o.numero}`} />}
                    </div>
                  ))}
                </div>
              )}
              {data.atualizadoEm && <p className="muted hp-sm">Dados de {new Date(data.atualizadoEm).toLocaleString("pt-BR").slice(0, 17)}</p>}
            </>
          )}
        </>
      )}
    </aside>
  );
}
