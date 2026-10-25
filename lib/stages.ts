export const STAGES = [
  { key: "novo", label: "Novo lead" },
  { key: "orcamento", label: "Orçamento enviado" },
  { key: "arte", label: "Arte em aprovação" },
  { key: "fechado", label: "Pedido fechado" },
  { key: "producao", label: "Em produção" },
  { key: "entregue", label: "Entregue" },
  { key: "perdido", label: "Perdido" },
] as const;

export type Stage = (typeof STAGES)[number]["key"];

export type Deal = {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  title: string;
  stage: Stage;
  value: number | null;
  notes: string | null;
  position: number;
  bling_order_id: number | null;
  bling_order_number: string | null;
  bling_error: string | null;
  created_at: string;
  updated_at: string;
};

export const OPEN_STAGES: Stage[] = ["novo", "orcamento", "arte", "fechado", "producao"];

export function isStage(s: unknown): s is Stage {
  return STAGES.some((st) => st.key === s);
}
