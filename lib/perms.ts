import { supabaseAdmin } from "./supabase/admin";

// Permissões dos atendentes. O administrador pode tudo e gerencia a equipe.
export const PERMS = {
  ver_todas: { label: "Ver tudo dos números liberados", desc: "Inclui as conversas encerradas, o Painel e direcionar conversas para colegas. Só vale para os números marcados para ele: os outros WhatsApps continuam bloqueados", padrao: false },
  apagar_historico: { label: "Apagar histórico de mensagens", desc: "Botão 🗑 Apagar histórico na conversa", padrao: false },
  sistema_gestao: { label: "Ver pedidos e saldo do sistema de gestão", desc: "Quadro 📦 Sistema de gestão ao lado da conversa", padrao: true },
  funil: { label: "Funil de vendas", desc: "Ver e mover os cards do funil", padrao: true },
  tarefas: { label: "Tarefas da equipe (kanban)", desc: "Ver, criar e mover cartões no quadro de tarefas", padrao: true },
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
  /** Canais (números de WhatsApp, e-mails, Instagram...) que o atendente pode ver. null = sem limite (dono/administrador). */
  canais: string[] | null;
};

// Guarda o atendente por 20 segundos para não consultar o banco a cada pedido.
const cacheAgent = new Map<string, { t: number; a: Agent | null }>();
export function limparCacheAgent() {
  cacheAgent.clear();
}

export async function getAgent(userId: string): Promise<Agent | null> {
  const c = cacheAgent.get(userId);
  if (c && Date.now() - c.t < 20_000) return c.a;
  const a = await lerAgent(userId);
  cacheAgent.set(userId, { t: Date.now(), a });
  return a;
}

async function lerAgent(userId: string): Promise<Agent | null> {
  const { data } = await supabaseAdmin().from("agents").select("*").eq("id", userId).maybeSingle();
  if (!data) return null;
  const role = data.role === "admin" ? "admin" : "agent";
  const lista = (data.permissions ?? {}).canais;
  return {
    id: data.id,
    name: data.name,
    role,
    permissions: (data.permissions ?? {}) as Agent["permissions"],
    active: data.active !== false,
    // Só o administrador vê todos os números. Atendente sem números marcados não vê nenhum
    // (só as conversas que forem passadas para ele).
    canais: role === "admin" ? null : Array.isArray(lista) ? (lista.filter((x: unknown) => typeof x === "string") as string[]) : [],
  };
}

/** Números/canais que o atendente pode usar. null = todos (dono/administrador). */
export function canaisDe(agent: Agent | null): string[] | null {
  return agent ? agent.canais : null;
}

/** O dono do sistema: o administrador mais antigo. Só ele mexe na equipe e dá acesso. */
export async function isDono(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("agents").select("id").eq("role", "admin").eq("active", true).order("created_at").limit(1).maybeSingle();
  return data?.id === userId;
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
  // Trava de envio do WhatsApp: todos veem o aviso; só o administrador muda limites ou libera número.
  if (path.startsWith("/api/trava") && escrita) return "admin";
  // Cadastrar ou apagar número de WhatsApp: só o administrador.
  if (path === "/api/whatsapp" && escrita) return "admin";
  if (/^\/api\/whatsapp\/[^/]+$/.test(path) && method === "DELETE") return "admin";
  if (path.startsWith("/api/instagram")) return escrita ? "admin" : "whatsapp";
  if (path === "/api/email/sync") return null;
  if (path.startsWith("/api/email")) return escrita ? "admin" : "whatsapp";
  if (path.startsWith("/api/whatsapp")) return "whatsapp";
  if (path.startsWith("/api/stats")) return "ver_todas";
  if (path.startsWith("/api/gestao")) return "sistema_gestao";
  if (/^\/api\/conversations\/[^/]+\/history/.test(path)) return "apagar_historico";
  if (/^\/api\/conversations\/[^/]+$/.test(path) && method === "DELETE") return "apagar_historico";
  if (path.startsWith("/api/crm") && escrita) return "admin";
  if (/^\/api\/tarefas\/quadros\/[^/]+$/.test(path) && method === "DELETE") return "admin";
  if (path.startsWith("/api/tarefas")) return "tarefas";
  if (path.startsWith("/api/deals")) return "funil";
  if ((path.startsWith("/api/settings") || path.startsWith("/api/quick-replies") || path.startsWith("/api/bling") || path.startsWith("/api/catalogo")) && escrita) return "configuracoes";
  if (path.startsWith("/api/departments") && escrita) return "departamentos";
  if (path.startsWith("/api/contacts") && escrita) return "contatos";
  return null;
}

/**
 * Atendente pode abrir esta conversa? Só as dos números liberados para ele e as que estão com ele.
 * Encerradas só com "Ver tudo dos números liberados".
 */
export function podeVerConversa(
  userId: string,
  conv: { assigned_to: string | null; status: string; connection_id?: string | null },
  canais: string[] | null,
  verTudo: boolean,
) {
  if (!canais) return true;
  if (conv.status === "closed" && !verTudo) return false;
  return conv.assigned_to === userId || (!!conv.connection_id && canais.includes(conv.connection_id));
}

/** Confere no banco se o atendente pode abrir a conversa (números liberados ou conversa com ele). */
export async function podeAbrirConversa(agent: Agent | null, conversationId: string): Promise<boolean> {
  if (!agent?.canais) return true;
  const { data: c } = await supabaseAdmin()
    .from("conversations")
    .select("assigned_to, status, connection_id")
    .eq("id", conversationId)
    .maybeSingle();
  return !c || podeVerConversa(agent.id, c, agent.canais, can(agent, "ver_todas"));
}

// E-mail -> atendente do OficinaZap (para quem chega pelo sistema de gestão). Guardado por 5 minutos.
let cacheEmails: { t: number; m: Map<string, string> } | null = null;
export async function agentePorEmail(email: string): Promise<Agent | null> {
  if (!cacheEmails || Date.now() - cacheEmails.t > 300_000) {
    const { data } = await supabaseAdmin().auth.admin.listUsers({ perPage: 1000 });
    cacheEmails = { t: Date.now(), m: new Map((data?.users ?? []).filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u.id])) };
  }
  const id = cacheEmails.m.get(email.trim().toLowerCase());
  return id ? getAgent(id) : null;
}
