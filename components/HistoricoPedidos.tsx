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
                        <a href={`${site}/#ped=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener">Abrir no sistema ↗</a>
                        {!FIM.includes(p.etapa) && <button onClick={() => rascunho(textoStatus(p))}>💬 Status para o cliente</button>}
                      </div>
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
                        <a href={`${site}/#orc=${encodeURIComponent(o.id)}`} target="_blank" rel="noopener">Abrir no sistema ↗</a>
                      </div>
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
