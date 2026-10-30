import { supabaseAdmin } from "./supabase/admin";

// Permissões dos atendentes. O administrador pode tudo e gerencia a equipe.
export const PERMS = {
  ver_todas: { label: "Ver todas as conversas", desc: "Desligado: vê só as suas, as do seu departamento e a fila geral", padrao: true },
  apagar_historico: { label: "Apagar histórico de mensagens", desc: "Botão 🗑 Apagar histórico na conversa", padrao: false },
  sistema_gestao: { label: "Ver pedidos e saldo do sistema de gestão", desc: "Quadro 📦 Sistema de gestão ao lado da conversa", padrao: true },
  funil: { label: "Funil de vendas", desc: "Ver e mover os cards do funil", padrao: true },
  contatos: { label: "Editar e importar contatos", desc: "Alterar nome/etiquetas e importar do Google", padrao: true },
  departamentos: { label: "Gerenciar departamentos", desc: "Criar, editar e excluir departamentos", padrao: false },
  whatsapp: { label: "Conectar números de WhatsApp", desc: "Tela WhatsApp: ler QR Code, desconectar", padrao: false },
  configuracoes: { label: "Configurações da IA e respostas rápidas", desc: "Informações da empresa, IA ligada/desligada, Bling", padrao: false },
} as const;

export type PermKey = keyof typeof PERMS;

export type Agent = {
  id: string;
  name: string;
  role: "admin" | "agent";
  permissions: Partial<Record<PermKey, boolean>>;
  active: boolean;
};

export async function getAgent(userId: string): Promise<Agent | null> {
  const { data } = await supabaseAdmin().from("agents").select("*").eq("id", userId).maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    role: data.role === "admin" ? "admin" : "agent",
    permissions: (data.permissions ?? {}) as Agent["permissions"],
    active: data.active !== false,
  };
}

export function can(agent: Agent | null, key: PermKey): boolean {
  if (!agent) return true; // sem cadastro de atendente: mantém o comportamento antigo
  if (agent.role === "admin") return true;
  const v = agent.permissions[key];
  return v === undefined ? PERMS[key].padrao : !!v;
}

export function allPerms(agent: Agent | null): Record<PermKey, boolean> {
  return Object.fromEntries(Object.keys(PERMS).map((k) => [k, can(agent, k as PermKey)])) as Record<PermKey, boolean>;
}

/** Qual permissão cada rota da API exige ("admin" = só administrador). */
export function permFor(method: string, path: string): PermKey | "admin" | null {
  const escrita = method !== "GET";
  if (path.startsWith("/api/team")) return "admin";
  if (path.startsWith("/api/whatsapp")) return "whatsapp";
  if (path.startsWith("/api/gestao")) return "sistema_gestao";
  if (/^\/api\/conversations\/[^/]+\/history/.test(path)) return "apagar_historico";
  if (path.startsWith("/api/deals")) return "funil";
  if ((path.startsWith("/api/settings") || path.startsWith("/api/quick-replies") || path.startsWith("/api/bling")) && escrita) return "configuracoes";
  if (path.startsWith("/api/departments") && escrita) return "departamentos";
  if (path.startsWith("/api/contacts") && escrita) return "contatos";
  return null;
}
