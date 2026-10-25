"use client";

import { useEffect, useState } from "react";
import { api, formatPhone, formatTime } from "@/lib/client";
import type { Contact } from "@/lib/db";

export default function ContactsPage() {
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<Contact[]>(`/api/contacts?q=${encodeURIComponent(q)}`).then(setContacts).catch(console.error);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="page">
      <h1>Contatos</h1>
      <div className="card">
        <input placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
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
