"use client";

// Configurações: mensagem de ausência e de saudação (como no WhatsApp Business) e a chave Pix da loja.

import { useState } from "react";

export type AusenciaCfg = {
  ausencia_ligada: boolean;
  mensagem_ausencia: string;
  dias: number[];
  inicio: string;
  fim: string;
  saudacao_ligada: boolean;
  saudacao: string;
  saudacao_dias: number;
  com_ia: boolean;
};
export type PixCfg = { tipo: "cpf" | "cnpj" | "telefone" | "email" | "aleatoria"; chave: string; nome: string; cidade: string };

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function AusenciaCard({ inicial, onSave }: { inicial: AusenciaCfg; onSave: (v: AusenciaCfg) => Promise<void> }) {
  const [v, setV] = useState(inicial);
  const set = (p: Partial<AusenciaCfg>) => setV((x) => ({ ...x, ...p }));
  return (
    <div className="card">
      <strong>Mensagem de ausência e saudação</strong>
      <p className="muted">
        Iguais às do WhatsApp Business. A <b>ausência</b> sai quando o cliente escreve fora do horário de atendimento (no máximo uma vez a cada 12 horas
        para o mesmo cliente). A <b>saudação</b> sai para cliente novo ou que não falava com a loja há alguns dias.
      </p>
      <p className="muted">
        🛡 Trava contra banimento: elas só respondem a quem escreveu (nunca iniciam conversa), não saem em grupos e, se muitos clientes escreverem ao
        mesmo tempo, o sistema segura as repetidas para a mesma mensagem não parecer disparo em massa.
      </p>
      <label className="row" style={{ gap: 10 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={v.ausencia_ligada} onChange={(e) => set({ ausencia_ligada: e.target.checked })} />
        <b>Mandar mensagem de ausência fora do horário</b>
      </label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
        {DIAS.map((d, i) => (
          <label key={d} className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={v.dias.includes(i)}
              onChange={(e) => set({ dias: e.target.checked ? [...v.dias, i].sort() : v.dias.filter((x) => x !== i) })}
            />
            {d}
          </label>
        ))}
        <label className="row" style={{ gap: 4 }}>
          das <input type="time" style={{ width: 110 }} value={v.inicio} onChange={(e) => set({ inicio: e.target.value })} />
        </label>
        <label className="row" style={{ gap: 4 }}>
          às <input type="time" style={{ width: 110 }} value={v.fim} onChange={(e) => set({ fim: e.target.value })} />
        </label>
        <span className="muted">(hora de Brasília)</span>
      </div>
      <textarea rows={3} value={v.mensagem_ausencia} onChange={(e) => set({ mensagem_ausencia: e.target.value })} />
      <label className="row" style={{ gap: 10, marginTop: 12 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={v.saudacao_ligada} onChange={(e) => set({ saudacao_ligada: e.target.checked })} />
        <b>Mandar saudação para cliente novo</b>
        <span className="muted">
          ou sem conversar há{" "}
          <input type="number" min={1} max={365} style={{ width: 70 }} value={v.saudacao_dias} onChange={(e) => set({ saudacao_dias: Number(e.target.value) })} /> dias
        </span>
      </label>
      <textarea rows={2} value={v.saudacao} onChange={(e) => set({ saudacao: e.target.value })} style={{ marginTop: 6 }} />
      <label className="row" style={{ gap: 10, marginTop: 10 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={v.com_ia} onChange={(e) => set({ com_ia: e.target.checked })} />
        <span>
          Mandar também quando a IA estiver atendendo
          <div className="muted">Desligado (recomendado), elas só saem quando a IA não vai responder, para o cliente não receber duas mensagens.</div>
        </span>
      </label>
      <div style={{ marginTop: 8 }}>
        <button className="primary" onClick={() => onSave(v)}>Salvar</button>
      </div>
    </div>
  );
}

export function PixCard({ inicial, onSave }: { inicial: PixCfg; onSave: (v: PixCfg) => Promise<void> }) {
  const [v, setV] = useState(inicial);
  const set = (p: Partial<PixCfg>) => setV((x) => ({ ...x, ...p }));
  return (
    <div className="card">
      <strong>Pix da loja</strong>
      <p className="muted">
        Na conversa, o botão <b>＋ &gt; Cobrar com Pix</b> monta a mensagem com esta chave e o código <b>Pix copia e cola</b> já com o valor. O atendente confere e
        envia. O dinheiro cai direto na conta da chave; o sistema não mexe em pagamento.
      </p>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ width: 170 }}>
          Tipo de chave
          <select value={v.tipo} onChange={(e) => set({ tipo: e.target.value as PixCfg["tipo"] })}>
            <option value="cnpj">CNPJ</option>
            <option value="cpf">CPF</option>
            <option value="telefone">Telefone</option>
            <option value="email">E-mail</option>
            <option value="aleatoria">Chave aleatória</option>
          </select>
        </label>
        <label style={{ width: 260 }}>
          Chave
          <input value={v.chave} onChange={(e) => set({ chave: e.target.value })} placeholder="ex.: 12.345.678/0001-90" />
        </label>
        <label style={{ width: 240 }}>
          Nome de quem recebe
          <input value={v.nome} onChange={(e) => set({ nome: e.target.value })} placeholder="ex.: Sacolas Oficina" />
        </label>
        <label style={{ width: 180 }}>
          Cidade
          <input value={v.cidade} onChange={(e) => set({ cidade: e.target.value })} placeholder="ex.: Vitória da Conquista" />
        </label>
        <button className="primary" onClick={() => onSave(v)}>Salvar</button>
      </div>
    </div>
  );
}
