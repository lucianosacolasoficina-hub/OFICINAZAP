"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Stats = {
  newToday: number;
  msgsToday: number;
  waiting: number;
  open: number;
  bot: number;
  newContacts: number;
  conv30: number;
  aiOnlyRate: number | null;
  funnel: { key: string; label: string; count: number; value: number }[];
  wonMonth: number;
};

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function DashboardPage() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () => api<Stats>("/api/stats").then(setS).catch(console.error);
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  if (!s) return <div className="page">Carregando...</div>;
  const maxCount = Math.max(1, ...s.funnel.map((f) => f.count));

  const tiles = [
    { n: s.waiting, l: "aguardando atendente agora" },
    { n: s.open, l: "em atendimento humano" },
    { n: s.bot, l: "sendo atendidas pela IA" },
    { n: s.newToday, l: "conversas novas hoje" },
    { n: s.msgsToday, l: "mensagens recebidas hoje" },
    { n: s.newContacts, l: "contatos novos (7 dias)" },
    { n: s.aiOnlyRate == null ? "—" : `${s.aiOnlyRate}%`, l: "resolvidas só pela IA (30 dias)" },
    { n: money(s.wonMonth), l: "vendido no mês (funil)" },
  ];

  return (
    <div className="page">
      <h1>Painel</h1>
      <div className="stats">
        {tiles.map((t) => (
          <div key={t.l} className="stat">
            <div className="n">{t.n}</div>
            <div className="l">{t.l}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <strong>Funil de vendas</strong>
        <table style={{ marginTop: 8 }}>
          <tbody>
            {s.funnel.map((f) => (
              <tr key={f.key}>
                <td style={{ width: 170 }}>{f.label}</td>
                <td style={{ width: 50 }}>{f.count}</td>
                <td>
                  <div className="bar" style={{ width: `${(f.count / maxCount) * 100}%`, minWidth: f.count ? 4 : 0 }} />
                </td>
                <td style={{ width: 130, textAlign: "right" }} className="muted">{f.value ? money(f.value) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
