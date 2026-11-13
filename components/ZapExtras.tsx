"use client";

// Recursos do WhatsApp Business na caixa de conversa: agendar mensagem, cobrar com Pix, enquete,
// lista das mensagens agendadas e os tracinhos (✓ enviada, ✓✓ entregue, ✓✓ azul lida).

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Message } from "@/lib/db";

type Agendada = { id: string; body: string; enviar_em: string; status: "pendente" | "enviando" | "erro"; erro: string | null };

/** "2026-11-14T09:00" no fuso do navegador, para o campo de data e hora. */
function paraCampo(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function emDias(dias: number, hora: number) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(hora, 0, 0, 0);
  return d;
}
function proximaSegunda() {
  const d = emDias(1, 9);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}
const quandoBR = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Tracinhos da mensagem enviada, como no WhatsApp. */
export function Tracinhos({ m }: { m: Message }) {
  if (m.direction !== "out" || m.sender === "system" || !m.entrega) return null;
  const t = m.entrega === "enviada" ? "✓" : "✓✓";
  const titulo = m.entrega === "lida" ? "Lida pelo cliente" : m.entrega === "entregue" ? "Entregue no celular do cliente" : "Enviada";
  return (
    <span className={`zx-tique ${m.entrega}`} title={titulo} aria-label={titulo}>
      {" "}
      {t}
    </span>
  );
}

/** Agendar: a mensagem sai sozinha no dia e na hora escolhidos. */
export function AgendarPop({ convId, texto, onDone, onClose }: { convId: string; texto: string; onDone: () => void; onClose: () => void }) {
  const [body, setBody] = useState(texto);
  const [quando, setQuando] = useState(paraCampo(emDias(1, 9)));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function agendar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro("");
    try {
      await api(`/api/conversations/${convId}/agendadas`, { method: "POST", body: JSON.stringify({ body, enviar_em: new Date(quando).toISOString() }) });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não consegui agendar");
    } finally {
      setSalvando(false);
    }
  }
  const atalhos: [string, Date][] = [
    ["Daqui 1 hora", new Date(Date.now() + 3600_000)],
    ["Amanhã 9h", emDias(1, 9)],
    ["Amanhã 14h", emDias(1, 14)],
    ["Segunda 9h", proximaSegunda()],
  ];
  return (
    <form className="zx-cat zx-extra" role="dialog" aria-label="Agendar mensagem" onClick={(e) => e.stopPropagation()} onSubmit={agendar}>
      <div className="zx-h">
        ⏰ Agendar mensagem
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Mensagem que vai sair para o cliente" required />
      <div className="zx-atalhos">
        {atalhos.map(([l, d]) => (
          <button key={l} type="button" className={paraCampo(d) === quando ? "on" : ""} onClick={() => setQuando(paraCampo(d))}>
            {l}
          </button>
        ))}
      </div>
      <label className="zx-campo">
        Dia e hora
        <input type="datetime-local" value={quando} min={paraCampo(new Date())} onChange={(e) => setQuando(e.target.value)} required />
      </label>
      <small className="pd-dica">Sai pelo mesmo número desta conversa. Você pode cancelar até a hora de sair.</small>
      {erro && <small className="zx-erro">{erro}</small>}
      <button className="primary" disabled={salvando || !body.trim()}>{salvando ? "Agendando…" : "Agendar"}</button>
    </form>
  );
}

/** Cobrar com Pix: monta a cobrança (texto + código copia e cola sozinho, fácil de copiar no celular) e envia ao cliente. */
export function PixPop({ convId, onEnviado, onClose }: { convId: string; onEnviado: () => void; onClose: () => void }) {
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prev, setPrev] = useState<{ texto: string; codigo: string } | null>(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  async function montar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro("");
    try {
      setPrev(await api<{ texto: string; codigo: string }>("/api/pix", { method: "POST", body: JSON.stringify({ valor, descricao }) }));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não consegui montar a cobrança");
    } finally {
      setBusy(false);
    }
  }
  async function enviar() {
    if (!prev) return;
    setBusy(true);
    setErro("");
    try {
      await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ body: prev.texto }) });
      if (prev.codigo) await api(`/api/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ body: prev.codigo }) });
      onEnviado();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não consegui enviar");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="zx-cat zx-extra" role="dialog" aria-label="Cobrar com Pix" onClick={(e) => e.stopPropagation()} onSubmit={montar}>
      <div className="zx-h">
        💰 Cobrar com Pix
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      {!prev ? (
        <>
          <label className="zx-campo">
            Valor (R$)
            <input inputMode="decimal" placeholder="ex.: 350,00" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
          </label>
          <label className="zx-campo">
            Referente a (opcional)
            <input placeholder="ex.: Pedido 1234 - sinal" maxLength={60} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </label>
          <small className="pd-dica">Vai com a chave da loja (BRA). Com valor, vai também o código Pix copia e cola já preenchido. Sem valor, sai só a chave. Você confere antes de enviar.</small>
          {erro && <small className="zx-erro">{erro}</small>}
          <button className="primary" disabled={busy}>{busy ? "Montando…" : valor.trim() ? "Ver a cobrança" : "Ver mensagem com a chave"}</button>
        </>
      ) : (
        <>
          <div className="zx-pix-prev">{prev.texto}</div>
          {prev.codigo && <div className="zx-pix-prev zx-pix-cod">{prev.codigo}</div>}
          <small className="pd-dica">{prev.codigo ? "Saem 2 mensagens: a cobrança e o código sozinho (o cliente toca e copia no celular)." : "Sai só a chave Pix da loja. Com valor, vai também o código copia e cola."}</small>
          {erro && <small className="zx-erro">{erro}</small>}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" onClick={() => setPrev(null)} disabled={busy}>Voltar</button>
            <button type="button" className="primary" onClick={enviar} disabled={busy}>{busy ? "Enviando…" : "Enviar para o cliente"}</button>
          </div>
        </>
      )}
    </form>
  );
}

/** Enquete: o cliente vota tocando nas opções (ex.: escolher a cor da sacola). */
export function EnquetePop({ convId, onDone, onClose }: { convId: string; onDone: () => void; onClose: () => void }) {
  const [pergunta, setPergunta] = useState("");
  const [opcoes, setOpcoes] = useState(["", ""]);
  const [varias, setVarias] = useState(false);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro("");
    try {
      await api(`/api/conversations/${convId}/enquete`, { method: "POST", body: JSON.stringify({ pergunta, opcoes, varias }) });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não consegui enviar a enquete");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="zx-cat zx-extra" role="dialog" aria-label="Enquete" onClick={(e) => e.stopPropagation()} onSubmit={enviar}>
      <div className="zx-h">
        📊 Enquete
        <button type="button" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      <input placeholder="Pergunta (ex.: Qual cor prefere para a sacola?)" value={pergunta} onChange={(e) => setPergunta(e.target.value)} maxLength={255} required autoFocus />
      {opcoes.map((o, i) => (
        <div key={i} className="zx-op">
          <input
            placeholder={`Opção ${i + 1}`}
            value={o}
            maxLength={100}
            onChange={(e) => setOpcoes((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {opcoes.length > 2 && (
            <button type="button" onClick={() => setOpcoes((v) => v.filter((_, j) => j !== i))} aria-label="Tirar opção">×</button>
          )}
        </div>
      ))}
      {opcoes.length < 12 && (
        <button type="button" className="zx-mini" onClick={() => setOpcoes((v) => [...v, ""])}>+ Opção</button>
      )}
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={varias} onChange={(e) => setVarias(e.target.checked)} />
        Pode escolher mais de uma
      </label>
      <small className="pd-dica">Os votos aparecem no WhatsApp do celular deste número.</small>
      {erro && <small className="zx-erro">{erro}</small>}
      <button className="primary" disabled={busy || !pergunta.trim() || opcoes.filter((o) => o.trim()).length < 2}>{busy ? "Enviando…" : "Enviar enquete"}</button>
    </form>
  );
}

/** Faixa acima da caixa com as mensagens agendadas desta conversa (e as que deram erro). */
export function AgendadasFaixa({ convId, versao }: { convId: string; versao: number }) {
  const [itens, setItens] = useState<Agendada[]>([]);
  const [aberta, setAberta] = useState(false);
  const carregar = useCallback(() => {
    api<Agendada[]>(`/api/conversations/${convId}/agendadas`).then(setItens).catch(() => setItens([]));
  }, [convId]);
  useEffect(() => {
    carregar();
    const t = setInterval(() => !document.hidden && carregar(), 30_000);
    return () => clearInterval(t);
  }, [carregar, versao]);
  if (!itens.length) return null;
  async function cancelar(a: Agendada) {
    await api(`/api/conversations/${convId}/agendadas?ag=${a.id}`, { method: "DELETE" }).catch((err) => alert(err.message));
    carregar();
  }
  const erros = itens.filter((a) => a.status === "erro").length;
  return (
    <div className="zx-agendadas">
      <button type="button" className="zx-ag-topo" onClick={() => setAberta((v) => !v)}>
        ⏰ {itens.length - erros > 0 && `${itens.length - erros} agendada${itens.length - erros > 1 ? "s" : ""}`}
        {erros > 0 && <b className="zx-erro"> {erros} não saiu</b>}
        <span className="muted"> · {aberta ? "esconder" : "ver"}</span>
      </button>
      {aberta &&
        itens.map((a) => (
          <div key={a.id} className={`zx-ag-it ${a.status}`}>
            <span>
              <b>{a.status === "erro" ? "Não saiu" : quandoBR(a.enviar_em)}</b> · {a.body.length > 90 ? a.body.slice(0, 90) + "…" : a.body}
              {a.erro && <small className="zx-erro"> ({a.erro})</small>}
            </span>
            {a.status !== "enviando" && (
              <button type="button" onClick={() => cancelar(a)} title={a.status === "erro" ? "Tirar da lista" : "Cancelar"}>
                {a.status === "erro" ? "OK" : "Cancelar"}
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
