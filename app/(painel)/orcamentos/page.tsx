"use client";

import { useEffect, useState } from "react";
import { api, formatPhone, formatTime } from "@/lib/client";
import type { QuoteData } from "@/lib/db";

type QuoteRow = {
  id: string;
  conversation_id: string;
  status: string;
  data: QuoteData;
  updated_at: string;
  contact: { name: string | null; phone: string };
};

const MAIN = ["produto", "quantidade", "tamanho", "prazo_desejado"];

export default function QuotesPage() {
  const [rows, setRows] = useState<QuoteRow[]>([]);

  useEffect(() => {
    api<QuoteRow[]>("/api/quotes").then(setRows).catch(console.error);
  }, []);

  return (
    <div className="page">
      <h1>Orçamentos coletados pela IA</h1>
      <table>
        <thead>
          <tr><th>Cliente</th><th>Produto</th><th>Quantidade</th><th>Tamanho</th><th>Prazo</th><th>Outros dados</th><th>Atualizado</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.contact.name || "sem nome"}
                <div className="muted">{formatPhone(r.contact.phone)}</div>
              </td>
              {MAIN.map((k) => <td key={k}>{r.data[k] ?? <span className="muted">—</span>}</td>)}
              <td className="muted" style={{ fontSize: 12 }}>
                {Object.entries(r.data)
                  .filter(([k]) => !MAIN.includes(k))
                  .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                  .join(" · ")}
              </td>
              <td className="muted">{formatTime(r.updated_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">Nenhum orçamento ainda.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
