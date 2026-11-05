"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { useMe } from "@/lib/useMe";

type Limites = { por_minuto: number; por_hora: number; por_dia: number; intervalo_seg: number; pausa_min: number; robo_10min: number };
type Numero = { id: string; nome: string; instance: string; phone: string | null; minuto: number; hora: number; dia: number; fila: number; pausa: { ate: string; motivo: string } | null };
type Aviso = { quando: string; instance: string; nome: string; motivo: string; lido?: boolean };
type Trava = { limites: Limites; numeros: Numero[]; avisos: Aviso[] };

const hora = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Faixa vermelha no topo para o master quando a trava pausou um número ou parou a IA. */
export function AvisoTrava() {
  const me = useMe();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const carregar = useCallback(() => {
    api<Trava>("/api/trava").then((t) => setAvisos(t.avisos.filter((a) => !a.lido))).catch(() => {});
  }, []);
  useEffect(() => {
    if (me?.role !== "admin") return;
    carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, [me, carregar]);
  if (me?.role !== "admin" || !avisos.length) return null;
  const a = avisos[0];
  return (
    <div className="trava-aviso" role="alert">
      <span>
        🛡️ <b>Proteção do WhatsApp</b> ({a.nome}, {hora(a.quando)}): {a.motivo}
        {avisos.length > 1 && ` (+${avisos.length - 1} aviso${avisos.length > 2 ? "s" : ""})`}
      </span>
      <Link href="/configuracoes#trava">Ver</Link>
      <button onClick={() => api("/api/trava", { method: "PUT", body: JSON.stringify({ lidos: true }) }).then(() => setAvisos([]))}>Ok, entendi</button>
    </div>
  );
}

const CAMPOS: { k: keyof Limites; label: string; min: number; max: number }[] = [
  { k: "por_minuto", label: "Máximo por minuto (cada número)", min: 1, max: 60 },
  { k: "por_hora", label: "Máximo por hora", min: 5, max: 1000 },
  { k: "por_dia", label: "Máximo em 24 horas", min: 10, max: 5000 },
  { k: "intervalo_seg", label: "Intervalo entre mensagens (segundos)", min: 1, max: 30 },
  { k: "pausa_min", label: "Pausa ao passar do limite (minutos)", min: 1, max: 1440 },
  { k: "robo_10min", label: "Respostas da IA por conversa em 10 min", min: 1, max: 30 },
];

/** Quadro em Configurações: limites, contagem de cada número e botão para liberar número pausado. */
export function TravaCard() {
  const me = useMe();
  const [t, setT] = useState<Trava | null>(null);
  const [lim, setLim] = useState<Limites | null>(null);
  const [ok, setOk] = useState("");
  const carregar = useCallback(() => api<Trava>("/api/trava").then((d) => { setT(d); setLim((l) => l ?? d.limites); }).catch(() => {}), []);
  useEffect(() => {
    carregar();
    const i = setInterval(carregar, 20_000);
    return () => clearInterval(i);
  }, [carregar]);
  if (!t || !lim) return null;
  const admin = me?.role === "admin";
  const put = async (b: object, msg: string) => {
    await api("/api/trava", { method: "PUT", body: JSON.stringify(b) });
    setOk(msg);
    setTimeout(() => setOk(""), 2500);
    await carregar();
  };
  return (
    <div className="card" id="trava">
      <strong>🛡️ Proteção contra bloqueio do WhatsApp</strong> {ok && <span className="tag">{ok}</span>}
      <p className="muted">
        Toda mensagem que sai pelo OficinaZap (atendentes e IA) entra numa fila por número, com um intervalo e uma pequena variação
        entre uma e outra. A mesma mensagem não sai duas vezes seguidas para o mesmo contato, a IA nunca responde outro número da
        empresa e para sozinha se ficar respondendo demais na mesma conversa. Se um número passar do limite, os envios dele pausam e
        o master recebe um aviso no topo da tela. Mensagens mandadas direto pelo celular não passam por aqui.
      </p>
      <table>
        <thead>
          <tr><th>Número</th><th>Último minuto</th><th>Última hora</th><th>24 horas</th><th>Situação</th></tr>
        </thead>
        <tbody>
          {t.numeros.map((n) => (
            <tr key={n.id}>
              <td>{n.nome}{n.phone ? <div className="muted">{n.phone}</div> : null}</td>
              <td>{n.minuto} / {t.limites.por_minuto}</td>
              <td>{n.hora} / {t.limites.por_hora}</td>
              <td>{n.dia} / {t.limites.por_dia}</td>
              <td>
                {n.pausa ? (
                  <>
                    <span style={{ color: "#c0392b" }}>⏸ Pausado até {hora(n.pausa.ate)}</span>
                    <div className="muted">{n.pausa.motivo}</div>
                    {admin && <button onClick={() => put({ liberar: n.instance }, "liberado")}>Liberar agora</button>}
                  </>
                ) : (
                  <span>✅ Normal{n.fila ? ` (${n.fila} na fila)` : ""}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
        {CAMPOS.map((c) => (
          <label key={c.k} style={{ width: 230 }}>
            {c.label}
            <input type="number" min={c.min} max={c.max} disabled={!admin} value={lim[c.k]} onChange={(e) => setLim({ ...lim, [c.k]: Number(e.target.value) })} />
          </label>
        ))}
        {admin && <button className="primary" onClick={() => put({ limites: lim }, "salvo")}>Salvar limites</button>}
      </div>
      {t.avisos.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>Últimos avisos ({t.avisos.length})</summary>
          <ul>
            {t.avisos.map((a, i) => (
              <li key={i}>{hora(a.quando)} · {a.nome}: {a.motivo}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
