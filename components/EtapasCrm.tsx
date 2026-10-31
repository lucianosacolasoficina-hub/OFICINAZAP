"use client";

import { useState } from "react";
import { api } from "@/lib/client";

export type Etapa = { key: string; label: string; color: string; fim?: boolean; bling?: boolean };

const CORES = ["#6b7280", "#2b6cb0", "#6b46c1", "#b83280", "#c05621", "#d69e2e", "#128c4a", "#2c7a7b", "#38a169", "#c53030"];

/** Editor das etapas do CRM: criar, renomear, trocar a cor, reordenar e apagar. */
export function EtapasCrm({ etapas, onClose, onSaved }: { etapas: Etapa[]; onClose: () => void; onSaved: (e: Etapa[]) => void }) {
  const [lista, setLista] = useState<Etapa[]>(etapas.map((e) => ({ ...e })));
  const [nova, setNova] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const muda = (i: number, p: Partial<Etapa>) => setLista((l) => l.map((e, k) => (k === i ? { ...e, ...p } : e)));
  const move = (i: number, d: number) =>
    setLista((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const c = [...l];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  function adicionar() {
    const label = nova.trim();
    if (!label) return;
    setLista((l) => [...l, { key: "", label, color: CORES[l.length % CORES.length] }]);
    setNova("");
  }

  async function salvar() {
    setSalvando(true);
    setErro("");
    try {
      const pend = nova.trim() ? [...lista, { key: "", label: nova.trim(), color: CORES[lista.length % CORES.length] }] : lista;
      const r = await api<{ etapas: Etapa[] }>("/api/crm/etapas", { method: "PUT", body: JSON.stringify({ etapas: pend }) });
      onSaved(r.etapas);
      onClose();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal crm-mod" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>Etapas do CRM</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Crie as etapas do seu jeito. Elas aparecem como filtros na tela de conversas e como colunas no Funil.
        </p>
        <div className="crm-lista">
          {lista.length === 0 && <p className="muted">Nenhuma etapa. Crie a primeira abaixo.</p>}
          {lista.map((e, i) => (
            <div key={i} className="crm-row">
              <input type="color" value={e.color} onChange={(ev) => muda(i, { color: ev.target.value })} title="Cor" />
              <input className="crm-nome" value={e.label} onChange={(ev) => muda(i, { label: ev.target.value })} placeholder="Nome da etapa" />
              <label title="Etapa final: o cliente sai do funil em andamento (ex.: Entregue, Perdido)">
                <input type="checkbox" checked={!!e.fim} onChange={(ev) => muda(i, { fim: ev.target.checked })} /> final
              </label>
              <label title="Ao chegar nesta etapa, cria o cliente e o pedido no Bling (se estiver conectado)">
                <input type="checkbox" checked={!!e.bling} onChange={(ev) => muda(i, { bling: ev.target.checked })} /> Bling
              </label>
              <button onClick={() => move(i, -1)} disabled={i === 0} title="Subir">↑</button>
              <button onClick={() => move(i, 1)} disabled={i === lista.length - 1} title="Descer">↓</button>
              <button className="crm-del" onClick={() => setLista((l) => l.filter((_, k) => k !== i))} title="Apagar etapa">🗑</button>
            </div>
          ))}
        </div>
        <div className="crm-add">
          <input value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => e.key === "Enter" && adicionar()} placeholder="Nova etapa (ex.: Aguardando arte)" />
          <button onClick={adicionar} disabled={!nova.trim()}>＋ Adicionar</button>
        </div>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <button
            className="crm-del"
            onClick={() => {
              if (confirm("Apagar todas as etapas da lista? (só vale depois de clicar em Salvar)")) setLista([]);
            }}
          >
            Limpar todas
          </button>
          <span style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}>Cancelar</button>
            <button className="primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
          </span>
        </div>
        {erro && <p style={{ color: "#c53030", margin: 0 }}>⚠ {erro}</p>}
      </div>
    </div>
  );
}
