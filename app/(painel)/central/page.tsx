"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatListTime, formatPhone, formatPreview, formatSince } from "@/lib/client";
import { FotoContato } from "@/components/FotoContato";

// Central de atendimento: uma coluna para cada número de WhatsApp, lado a lado, atualizando sozinha.
type Conn = { id: string; name: string; phone?: string | null; connected_at: string | null };
type Stats = { todas: number; pendentes: number; abertas: number; robo: number; ativas?: number };
type Summary = { connections: Conn[]; numeros?: Record<string, Stats>; views?: Record<string, number>; alertas?: { espera_min: number; retomar_dias: number } };
type Row = {
  id: string;
  status: string;
  unread_count: number;
  last_message_at: string;
  last_message_preview: string | null;
  waiting_since: string | null;
  connection_id: string | null;
  contact: { id: string; name: string | null; phone: string; is_group: boolean };
  agent: { id: string; name: string } | null;
};

// Abas principais (com o número na própria aba, como no WhatsApp Business / Chatwoot) e o resto em "Mais".
const ABAS = [
  { key: "pendentes", label: "Aguardando", dica: "Cliente mandou mensagem e está esperando resposta" },
  { key: "abertas", label: "Abertas", dica: "Todas as conversas em andamento (aguardando, em atendimento e com a IA)" },
  { key: "tudo", label: "Todas", dica: "Todas as conversas deste número, inclusive as encerradas (como no WhatsApp)" },
] as const;
const MAIS = [
  { key: "atendimento", label: "Em atendimento" },
  { key: "robo", label: "Com a IA" },
  { key: "naolidas", label: "Não lidas" },
  { key: "retomar", label: "Retomar (cliente sumiu)" },
  { key: "fechadas", label: "Encerradas" },
] as const;
const LATE_MIN = 30;
const PAGINA = 50;
const MAX_ATUALIZA = 500;

/** Um cliente aparece uma vez por número: fica a conversa mais recente. */
function semRepetidas(rows: Row[]) {
  const vistos = new Set<string>();
  return rows.filter((c) => {
    const k = `${c.contact.id}|${c.connection_id ?? ""}`;
    if (vistos.has(k) || vistos.has(c.id)) return false;
    vistos.add(k);
    vistos.add(c.id);
    return true;
  });
}

type Contato = { id: string; name: string | null; phone: string };

/** Dígitos de um número digitado (com o 55 na frente quando veio só DDD + número). */
function numeroDigitado(q: string) {
  if (/[a-zà-ú]/i.test(q)) return "";
  const d = q.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d.length >= 12 && d.length <= 13 ? d : "";
}

/** Abre a conversa com o contato por este número (se ainda não existe, cria). */
async function conversarCom(connId: string, phone: string, name?: string) {
  const { id } = await api<{ id: string }>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ phone, name: name || undefined, connection_id: connId }),
  });
  return id;
}

function ItemContato({ c, onClick, dica = "Contato" }: { c: Contato; onClick: () => void; dica?: string }) {
  const nome = c.name || formatPhone(c.phone);
  return (
    <button className="cc-item cc-contato" onClick={onClick} title={`Abrir conversa com ${nome}`}>
      <FotoContato id={c.id} name={nome} phone={c.phone} size={40} />
      <span className="cc-body">
        <span className="cc-l1"><b>{nome}</b></span>
        <span className="cc-prev">{c.name ? formatPhone(c.phone) : dica}</span>
      </span>
    </button>
  );
}

// Painel "Nova conversa" dentro da caixa, como no WhatsApp: busca nos contatos salvos,
// número digitado na hora ou cadastro de um contato novo. A conversa sai por este número.
function NovaConversa({ conn, onFechar, onAbrir }: { conn: Conn; onFechar: () => void; onAbrir: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<Contato[] | null>(null);
  const [fim, setFim] = useState(false);
  const [novo, setNovo] = useState<{ name: string; phone: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const LIM = 60;
  // Proteção contra banimento: quantos primeiros contatos este número já fez (limite por hora e por dia).
  const [frios, setFrios] = useState<{ hora: number; dia: number; max_hora: number; max_dia: number } | null>(null);
  useEffect(() => {
    api<{ hora: number; dia: number; max_hora: number; max_dia: number }>(`/api/trava?frios=${conn.id}`).then(setFrios).catch(() => {});
  }, [conn.id]);

  const ler = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ whats: "1", ordem: "nome", limit: String(LIM), offset: String(offset) });
      if (q.trim()) p.set("q", q.trim());
      return api<Contato[]>(`/api/contacts?${p}`);
    },
    [q],
  );
  useEffect(() => {
    let vivo = true;
    setLista(null);
    const t = setTimeout(() => {
      ler(0)
        .then((r) => {
          if (!vivo) return;
          setLista(r);
          setFim(r.length < LIM);
        })
        .catch((e) => vivo && setErro(e.message));
    }, q ? 250 : 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [ler, q]);
  const mais = async () => {
    if (!lista || fim) return;
    const r = await ler(lista.length);
    setLista([...lista, ...r]);
    setFim(r.length < LIM);
  };

  const abrir = async (phone: string, name?: string) => {
    setBusy(true);
    setErro("");
    try {
      onAbrir(await conversarCom(conn.id, phone, name));
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não deu para abrir a conversa");
      setBusy(false);
    }
  };

  const num = numeroDigitado(q);
  const numJaSalvo = !!num && !!lista?.some((c) => c.phone === num);
  const letras = /[a-zà-ú]/i.test(q) ? q.trim() : "";

  return (
    <div className="cc-nc" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), novo ? setNovo(null) : onFechar())}>
      <header className="cc-nc-h">
        <button className="cc-nc-voltar" onClick={() => (novo ? setNovo(null) : onFechar())} aria-label="Voltar" title="Voltar (Esc)">←</button>
        <div>
          <b>{novo ? "Novo contato" : "Nova conversa"}</b>
          <small>pelo número {conn.name}{conn.phone ? ` · ${formatPhone(conn.phone)}` : ""}</small>
        </div>
      </header>
      {!conn.connected_at && <p className="cc-alerta" style={{ padding: "6px 12px" }}>Este número está desconectado: a mensagem só sai quando ele voltar.</p>}
      {erro && <p className="cc-alerta" style={{ padding: "6px 12px" }}>{erro}</p>}
      {frios && (
        <p className={`cc-nc-trava${frios.hora >= frios.max_hora || frios.dia >= frios.max_dia ? " cheio" : ""}`}>
          🛡️ Proteção da conta: chamar quem <b>nunca falou</b> com este número conta como primeiro contato. Hoje: <b>{frios.dia} de {frios.max_dia}</b> (até {frios.max_hora} por hora). Clientes que já conversaram são livres. Não mande a mesma mensagem para vários números novos.
        </p>
      )}
      {novo ? (
        <form
          className="cc-nc-form"
          onSubmit={(e) => {
            e.preventDefault();
            abrir(novo.phone, novo.name.trim());
          }}
        >
          <label>
            Nome
            <input value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} placeholder="Ex.: Maria da Loja Bela" autoFocus={!novo.name} />
          </label>
          <label>
            WhatsApp (com DDD)
            <input value={novo.phone} onChange={(e) => setNovo({ ...novo, phone: e.target.value })} placeholder="(77) 99999-8888" inputMode="tel" required autoFocus={!!novo.name} />
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>O contato fica salvo no OficinaZap (e no Google Contatos) e a conversa abre aqui para você mandar a primeira mensagem. Se o número já existir, abre a conversa dele.</p>
          <button className="primary" disabled={busy || !novo.phone.trim()}>{busy ? "Abrindo…" : "Salvar e abrir conversa"}</button>
        </form>
      ) : (
        <>
          <div className="cc-nc-busca">
            <input className="cc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contato por nome ou número…" autoFocus />
          </div>
          <div className="cc-list">
            <button className="cc-item cc-nc-acao" onClick={() => setNovo({ name: letras, phone: num ? formatPhone(num) : q.replace(/[^\d()+\s-]/g, "").trim() })} disabled={busy}>
              <span className="cc-nc-ic" aria-hidden="true">👤＋</span>
              <span className="cc-body"><b>Novo contato</b><span className="cc-prev">Cadastrar e já começar a conversa</span></span>
            </button>
            {num && !numJaSalvo && (
              <button className="cc-item cc-nc-acao" onClick={() => abrir(num)} disabled={busy}>
                <span className="cc-nc-ic" aria-hidden="true">💬</span>
                <span className="cc-body"><b>Conversar com {formatPhone(num)}</b><span className="cc-prev">Número novo: conta como primeiro contato (proteção da conta)</span></span>
              </button>
            )}
            <p className="cc-sec">Contatos{q.trim() ? " encontrados" : ""}</p>
            {lista === null && <p className="muted cc-vazio">Carregando…</p>}
            {lista?.length === 0 && <p className="muted cc-vazio">Nenhum contato com “{q.trim()}”.</p>}
            {lista?.map((c) => <ItemContato key={c.id} c={c} onClick={() => !busy && abrir(c.phone)} />)}
            {lista && lista.length > 0 && !fim && (
              <button className="cc-carregar" onClick={() => mais().catch(() => {})}>Mostrar mais contatos</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Coluna({ conn, stats, onAbrir, aberta, lateMin = LATE_MIN, max = false, onMax }: { conn: Conn; stats?: Stats; onAbrir: (id: string) => void; aberta: string | null; lateMin?: number; max?: boolean; onMax?: () => void }) {
  const [filtro, setFiltro] = useState<string>(() => {
    try {
      return localStorage.getItem(`central2_${conn.id}`) || "abertas";
    } catch {
      return "abertas";
    }
  });
  const [lista, setLista] = useState<Row[] | null>(null);
  const [fim, setFim] = useState(false);
  const [maisCarregando, setMaisCarregando] = useState(false);
  const [q, setQ] = useState("");
  const [nova, setNova] = useState(false);
  // Buscando: também mostra os contatos salvos que ainda não têm conversa nesta caixa (como no WhatsApp).
  const [achados, setAchados] = useState<Contato[]>([]);
  const [erroAbrir, setErroAbrir] = useState("");
  useEffect(() => {
    const t = q.trim();
    setAchados([]);
    setErroAbrir("");
    if (t.length < 2) return;
    let vivo = true;
    const id = setTimeout(() => {
      api<Contato[]>(`/api/contacts?${new URLSearchParams({ whats: "1", ordem: "nome", limit: "15", q: t })}`)
        .then((r) => vivo && setAchados(r))
        .catch(() => {});
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [q]);
  const abrirContato = async (phone: string) => {
    setErroAbrir("");
    try {
      onAbrir(await conversarCom(conn.id, phone));
    } catch (e) {
      setErroAbrir(e instanceof Error ? e.message : "não deu para abrir a conversa");
    }
  };
  // Tudo que já veio do servidor (com repetidas), para saber de onde continuar ao rolar.
  const bruto = useRef<Row[]>([]);
  const chave = `${filtro}|${conn.id}|${q.trim()}`;
  const chaveAtual = useRef(chave);
  chaveAtual.current = chave;

  const buscar = useCallback(
    (offset: number, limit: number) => {
      const p = new URLSearchParams({ view: filtro, queue: "todas", connection: conn.id, offset: String(offset), limit: String(limit), dedup: "0" });
      if (q.trim()) p.set("q", q.trim());
      return api<Row[]>(`/api/conversations?${p}`);
    },
    [filtro, conn.id, q],
  );

  // Atualiza o que já está na tela (a cada 10 s) sem perder o que foi carregado rolando.
  const carregar = useCallback(async () => {
    const k = chave;
    const n = Math.min(Math.max(bruto.current.length, PAGINA), MAX_ATUALIZA);
    const rows = await buscar(0, n);
    if (chaveAtual.current !== k) return;
    const resto = bruto.current.length > n ? bruto.current.slice(n) : [];
    bruto.current = [...rows, ...resto];
    if (!resto.length) setFim(rows.length < n);
    setLista(semRepetidas(bruto.current));
  }, [buscar, chave]);

  const carregarMais = useCallback(async () => {
    if (fim || maisCarregando || lista === null) return;
    const k = chave;
    setMaisCarregando(true);
    try {
      const rows = await buscar(bruto.current.length, PAGINA);
      if (chaveAtual.current !== k) return;
      bruto.current = [...bruto.current, ...rows];
      setFim(rows.length < PAGINA);
      setLista(semRepetidas(bruto.current));
    } finally {
      setMaisCarregando(false);
    }
  }, [buscar, chave, fim, maisCarregando, lista]);

  useEffect(() => {
    try {
      localStorage.setItem(`central2_${conn.id}`, filtro);
    } catch {}
  }, [filtro, conn.id]);

  useEffect(() => {
    bruto.current = [];
    setLista(null);
    setFim(false);
  }, [chave]);

  useEffect(() => {
    const t0 = setTimeout(() => carregar().catch(() => {}), q ? 300 : 0);
    const t = setInterval(() => !document.hidden && carregar().catch(() => {}), 10000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [carregar, q]);

  // Rolagem infinita: chegando perto do fim da lista, carrega mais 50.
  const rolar = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) carregarMais().catch(() => {});
  };

  const online = !!conn.connected_at;
  // Passar o mouse por uma aba já mostra a lista dela, sem precisar clicar.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passar = (key: string) => ({
    onMouseEnter: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFiltro(key), 250);
    },
    onMouseLeave: () => {
      if (timer.current) clearTimeout(timer.current);
    },
    onClick: () => {
      if (timer.current) clearTimeout(timer.current);
      setFiltro(key);
    },
  });
  const contagem: Record<string, number | undefined> = {
    pendentes: stats?.pendentes,
    abertas: stats?.ativas,
    tudo: stats?.todas,
    atendimento: stats?.abertas,
    robo: stats?.robo,
  };
  const noMais = MAIS.some((m) => m.key === filtro);
  const buscando = q.trim().length >= 2;
  const naLista = new Set((lista ?? []).map((c) => c.contact.id));
  const contatosSemConversa = achados.filter((c) => !naLista.has(c.id));
  const num = numeroDigitado(q);
  const numConhecido = !!num && ((lista ?? []).some((c) => c.contact.phone === num) || achados.some((c) => c.phone === num));
  if (nova) {
    return (
      <section className={`cc-col${online ? "" : " off"}${max ? " max" : ""}`}>
        <NovaConversa conn={conn} onFechar={() => setNova(false)} onAbrir={onAbrir} />
      </section>
    );
  }
  return (
    <section className={`cc-col${online ? "" : " off"}${max ? " max" : ""}`}>
      <header className="cc-h" onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button,input,select")) onMax?.(); }}>
        <div className="cc-t">
          <span className={`num-dot ${online ? "ok" : "off"}`} title={online ? "Conectado" : "Desconectado"} />
          <div>
            <b>{conn.name}</b>
            <small>{conn.phone ? formatPhone(conn.phone) : "sem número"}</small>
          </div>
          <button className="primary cc-novabtn" onClick={() => setNova(true)} title="Começar uma conversa nova por este número (buscar contato, digitar número ou cadastrar)">
            <span aria-hidden="true">✎</span> Nova conversa
          </button>
          {onMax && (
            <button className="cc-max" onClick={onMax} title={max ? "Voltar para todas as caixas (Esc)" : "Abrir esta caixa na tela toda"} aria-label={max ? "Reduzir" : "Expandir"}>
              {max ? "⤡" : "⤢"}
            </button>
          )}
        </div>
        {!online && <p className="cc-alerta">Desconectado: as mensagens deste número não estão chegando.</p>}
        <div className="cc-abas" role="tablist">
          {ABAS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filtro === f.key} className={`${filtro === f.key ? "on" : ""}${f.key === "pendentes" && (stats?.pendentes ?? 0) > 0 ? " alerta" : ""}`} title={f.dica} {...passar(f.key)}>
              {f.label}
              {contagem[f.key] !== undefined && <span className="cc-n">{contagem[f.key]}</span>}
            </button>
          ))}
          <select className={`cc-mais${noMais ? " on" : ""}`} value={noMais ? filtro : ""} onChange={(e) => e.target.value && setFiltro(e.target.value)} title="Outros filtros" aria-label="Outros filtros">
            <option value="">Mais…</option>
            {MAIS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
                {contagem[m.key] !== undefined ? ` (${contagem[m.key]})` : ""}
              </option>
            ))}
          </select>
        </div>
        <input className="cc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversa ou contato (nome, número ou mensagem)…" />
      </header>
      <div className="cc-list" onScroll={rolar}>
        {lista === null && <p className="muted cc-vazio">Carregando…</p>}
        {buscando && lista !== null && <p className="cc-sec">Conversas</p>}
        {lista?.length === 0 && <p className="muted cc-vazio">{buscando ? `Nenhuma conversa com “${q.trim()}” neste filtro.` : "Nenhuma conversa aqui."}</p>}
        {lista?.map((c) => {
          const nome = c.contact.name || (c.contact.is_group ? "Grupo" : formatPhone(c.contact.phone));
          const espera = c.waiting_since && c.status !== "closed" && !c.contact.is_group ? c.waiting_since : null;
          const late = espera && Date.now() - new Date(espera).getTime() > lateMin * 60_000;
          return (
            <button key={c.id} className={`cc-item${aberta === c.id ? " on" : ""}${c.unread_count ? " nova" : ""}${c.status === "closed" ? " fechada" : ""}`} onClick={() => onAbrir(c.id)}>
              <FotoContato id={c.contact.id} name={nome} phone={c.contact.phone} size={40} />
              <span className="cc-body">
                <span className="cc-l1">
                  <b>{nome}</b>
                  <small>{formatListTime(c.last_message_at)}</small>
                </span>
                <span className="cc-prev">{formatPreview(c.last_message_preview) || " "}</span>
                <span className="cc-l3">
                  {espera && <span className={`cc-wait${late ? " late" : ""}`}>⏳ {formatSince(espera)}</span>}
                  {c.status === "bot" && <span className="cc-chip">🤖 IA</span>}
                  {c.status === "closed" && <span className="cc-chip">✔ encerrada</span>}
                  {c.agent && <span className="cc-chip">👤 {c.agent.name}</span>}
                  {c.unread_count > 0 && <span className="cc-un">{c.unread_count > 99 ? "99+" : c.unread_count}</span>}
                </span>
              </span>
            </button>
          );
        })}
        {lista && lista.length > 0 && !fim && (
          <button className="cc-carregar" onClick={() => carregarMais().catch(() => {})} disabled={maisCarregando}>
            {maisCarregando ? "Carregando…" : "Carregar mais conversas"}
          </button>
        )}
        {buscando && (contatosSemConversa.length > 0 || (num && !numConhecido)) && (
          <>
            <p className="cc-sec">Contatos</p>
            {erroAbrir && <p className="cc-alerta" style={{ padding: "4px 12px" }}>{erroAbrir}</p>}
            {num && !numConhecido && (
              <button className="cc-item cc-nc-acao" onClick={() => abrirContato(num)}>
                <span className="cc-nc-ic" aria-hidden="true">💬</span>
                <span className="cc-body"><b>Conversar com {formatPhone(num)}</b><span className="cc-prev">Abrir conversa nova por este número</span></span>
              </button>
            )}
            {contatosSemConversa.map((c) => (
              <ItemContato key={c.id} c={c} onClick={() => abrirContato(c.phone)} dica="Contato salvo · clique para conversar" />
            ))}
          </>
        )}
        {!buscando && lista !== null && (
          <button className="cc-carregar cc-nova-rodape" onClick={() => setNova(true)}>✎ Começar nova conversa</button>
        )}
      </div>
    </section>
  );
}

export default function CentralPage() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  // Arrumação: "lado" = colunas lado a lado (rola para o lado); "grade" = todas na tela (até 6: 3 em cima e 3 embaixo).
  const [modo, setModo] = useState<"lado" | "grade">("grade");
  const [ocultos, setOcultos] = useState<string[]>([]);
  const [maxId, setMaxId] = useState<string | null>(null);
  // Conversa aberta na tela toda (com painel do cliente, pedidos e ferramentas) ou numa janela lateral.
  const [cheia, setCheia] = useState(true);
  useEffect(() => {
    try { setCheia(localStorage.getItem("oz.centralCheia") !== "0"); } catch {}
  }, []);
  const mudarCheia = (v: boolean) => {
    setCheia(v);
    try { localStorage.setItem("oz.centralCheia", v ? "1" : "0"); } catch {}
  };
  // No PC a conversa abre ao lado das caixas, no espaço livre da tela (sem cobrir as caixas).
  const [dock, setDock] = useState(true);
  const [largo, setLargo] = useState(false);
  useEffect(() => {
    try { setDock(localStorage.getItem("oz.centralDock") !== "0"); } catch {}
    const mq = window.matchMedia("(min-width: 1000px)");
    const f = () => setLargo(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const mudarDock = (v: boolean) => {
    setDock(v);
    if (!v) mudarCheia(true);
    try { localStorage.setItem("oz.centralDock", v ? "1" : "0"); } catch {}
  };
  const lado = !!aberta && dock && largo;
  // Barra lateral da Central pode ser escondida para sobrar mais espaço para as caixas e a conversa.
  const [semLateral, setSemLateral] = useState(false);
  useEffect(() => {
    try { setSemLateral(localStorage.getItem("oz.centralSemLateral") === "1"); } catch {}
  }, []);
  const mudarLateral = (v: boolean) => {
    setSemLateral(v);
    try { localStorage.setItem("oz.centralSemLateral", v ? "1" : "0"); } catch {}
  };
  useEffect(() => {
    try {
      const m = localStorage.getItem("oz.centralModo");
      if (m === "lado" || m === "grade") setModo(m);
      setOcultos(JSON.parse(localStorage.getItem("oz.centralOcultos") || "[]"));
    } catch {}
  }, []);
  const mudarModo = (m: "lado" | "grade") => {
    setModo(m);
    try { localStorage.setItem("oz.centralModo", m); } catch {}
  };
  const mudarOcultos = (o: string[]) => {
    setOcultos(o);
    try { localStorage.setItem("oz.centralOcultos", JSON.stringify(o)); } catch {}
  };

  useEffect(() => {
    const ler = () => api<Summary>("/api/conversations/summary?view=todas&queue=todas").then(setSum).catch((e) => setErro(e.message));
    ler();
    const t = setInterval(() => !document.hidden && ler(), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAberta((a) => {
        if (!a) setMaxId(null);
        return null;
      });
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  return (
    <div className={`cc cc-lat${lado ? " com-dock" : ""}${semLateral ? " sem-lateral" : ""}`}>
      <div className="cc-side-wrap">
      <button
        className="lado-tg cc-tg"
        onClick={() => mudarLateral(!semLateral)}
        title={semLateral ? "Mostrar a barra das caixas" : "Esconder a barra das caixas"}
        aria-label={semLateral ? "Mostrar a barra das caixas" : "Esconder a barra das caixas"}
        aria-expanded={!semLateral}
      >
        {semLateral ? "›" : "‹"}
      </button>
      <aside className="cc-side">

      <div className="cc-top">
        <h1>Central de atendimento</h1>
        <span className="muted">Uma caixa para cada número/canal · atualiza sozinha · clique numa conversa para responder</span>
        <span className="cc-modo">
          <button className={modo === "grade" ? "on" : ""} onClick={() => mudarModo("grade")} title="Todas as caixas na tela (3 em cima, 3 embaixo)">▦ Todas na tela</button>
          <button className={modo === "lado" ? "on" : ""} onClick={() => mudarModo("lado")} title="Colunas lado a lado, rolando para o lado">▥ Lado a lado</button>
        </span>
      </div>
      {sum && sum.connections.length > 1 && (
        <div className="cc-chips" role="group" aria-label="Caixas que aparecem na tela">
          <span className="cc-chips-t">Caixas na tela:</span>
          {sum.connections.map((c) => {
            const on = !ocultos.includes(c.id);
            return (
              <button
                key={c.id}
                className={on ? "on" : ""}
                aria-pressed={on}
                title={on ? "Clique para tirar esta caixa da tela" : "Clique para mostrar esta caixa"}
                onClick={() => mudarOcultos(on ? [...ocultos, c.id] : ocultos.filter((x) => x !== c.id))}
              >
                <span aria-hidden="true">{on ? "✓" : "+"}</span> {c.name}
              </button>
            );
          })}
          {ocultos.length > 0 && (
            <button className="cc-chips-all" onClick={() => mudarOcultos([])}>Mostrar todas</button>
          )}
        </div>
      )}
      {erro && <p style={{ color: "var(--danger)", padding: "0 16px" }}>{erro}</p>}
      {!!sum?.views?.atrasadas && (
        <p className="cc-alerta espera" style={{ margin: "0 16px 8px" }} role="alert">
          ⚠ {sum.views.atrasadas} {sum.views.atrasadas === 1 ? "cliente esperando" : "clientes esperando"} resposta há mais de {sum.alertas?.espera_min ?? LATE_MIN} min (em vermelho nas caixas).
        </p>
      )}
      </aside>
      </div>
      <div className={`cc-cols${modo === "grade" ? " grade" : ""}`}>
        {!sum && <p className="muted" style={{ padding: 16 }}>Carregando…</p>}
        {sum?.connections.filter((c) => !ocultos.includes(c.id)).map((c) => (
          <Coluna key={c.id} conn={c} stats={sum.numeros?.[c.id]} onAbrir={setAberta} aberta={aberta} lateMin={sum.alertas?.espera_min} max={maxId === c.id} onMax={() => setMaxId(maxId === c.id ? null : c.id)} />
        ))}
      </div>
      {lado && (
        <section className="cc-dock" aria-label="Conversa aberta">
          <div className="cc-dbar">
            <button onClick={() => setAberta(null)}>× Fechar conversa</button>
            <button className="cc-dmodo" onClick={() => mudarDock(false)} title="Abrir a conversa na tela toda">⤢ Tela toda</button>
          </div>
          <iframe key={aberta} src={`/?c=${aberta}&embed=1`} title="Conversa" />
        </section>
      )}
      {aberta && !lado && (
        <div className="cc-drawer-bg" onClick={() => setAberta(null)}>
          <div className={`cc-drawer${cheia ? " cheia" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="cc-dbar">
              <button onClick={() => setAberta(null)}>← Voltar para a Central</button>
              {largo ? (
                <button className="cc-dmodo" onClick={() => mudarDock(true)} title="Abrir a conversa ao lado das caixas">⇤ Abrir ao lado das caixas</button>
              ) : (
                <button className="cc-dmodo" onClick={() => mudarCheia(!cheia)} title={cheia ? "Abrir a conversa numa janela lateral" : "Abrir a conversa na tela toda"}>
                  {cheia ? "⤡ Janela lateral" : "⤢ Tela toda"}
                </button>
              )}
            </div>
            <iframe key={aberta} src={`/?c=${aberta}&embed=1`} title="Conversa" />
          </div>
        </div>
      )}
    </div>
  );
}
