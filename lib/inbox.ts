import { STAGES } from "./stages";
import { can, getAgent } from "./perms";
import { supabaseAdmin } from "./supabase/admin";

// Filtros da tela de conversas (lado esquerdo), usados na lista e nos contadores.
export const VIEWS = ["todas", "minhas", "pendentes", "grupos", "robo", "equipe", "fechadas"] as const;
export const QUEUES = ["todas", "minhas", "departamento", "geral"] as const;

export type View = (typeof VIEWS)[number];
export type Queue = (typeof QUEUES)[number];

export type InboxFilter = {
  view: View;
  queue: Queue;
  /** Etapa do funil de vendas (CRM). */
  stage?: string | null;
  /** Id do departamento ou "none" (sem departamento). */
  department?: string | null;
  search?: string | null;
};

/** O que precisa ser buscado antes para montar os filtros. */
type Lookups = { myDepartments: string[]; stageContacts: Map<string, string[]>; searchContacts: string[] | null; restrito?: boolean };

// Só os métodos de filtro que usamos, para aceitar tanto a lista quanto a contagem.
type Filterable<T> = {
  eq(column: string, value: unknown): T;
  neq(column: string, value: unknown): T;
  is(column: string, value: null | boolean): T;
  in(column: string, values: readonly unknown[]): T;
  or(filters: string): T;
};

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Tira caracteres que quebram a sintaxe de filtro do Supabase. */
function cleanSearch(q: string) {
  return q.replace(/[,()*%\\:"]/g, " ").trim();
}

export function parseFilter(params: URLSearchParams): InboxFilter {
  const view = params.get("view") as View;
  const queue = params.get("queue") as Queue;
  return {
    view: VIEWS.includes(view) ? view : "todas",
    queue: QUEUES.includes(queue) ? queue : "todas",
    stage: params.get("stage"),
    department: params.get("department"),
    search: params.get("q"),
  };
}

export async function loadLookups(userId: string, stages: string[], search?: string | null): Promise<Lookups> {
  const db = supabaseAdmin();
  const q = search ? cleanSearch(search) : "";
  const [mine, deals, contacts] = await Promise.all([
    db.from("department_agents").select("department_id").eq("agent_id", userId),
    stages.length ? db.from("deals").select("contact_id, stage").in("stage", stages) : Promise.resolve({ data: [], error: null }),
    q
      ? db.from("contacts").select("id").or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, "") || q}%`).limit(300)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const stageContacts = new Map<string, string[]>(stages.map((s) => [s, []]));
  for (const d of check(deals) as { contact_id: string; stage: string }[]) stageContacts.get(d.stage)?.push(d.contact_id);
  const agent = await getAgent(userId);
  return {
    restrito: !can(agent, "ver_todas"),
    myDepartments: (check(mine) as { department_id: string }[]).map((m) => m.department_id),
    stageContacts,
    searchContacts: q ? (check(contacts) as { id: string }[]).map((c) => c.id) : null,
  };
}

export function applyFilter<T extends Filterable<T>>(query: T, f: InboxFilter, userId: string, lk: Lookups): T {
  let q = query;
  // Atendente sem acesso total: só os clientes que ele está atendendo e os que ainda aguardam
  // atendimento (sem atendente), nunca as encerradas nem as dos colegas.
  if (lk.restrito) {
    const deps = lk.myDepartments.length ? `,department_id.in.(${lk.myDepartments.join(",")})` : "";
    q = q.neq("status", "closed").or(`assigned_to.eq.${userId},and(assigned_to.is.null,or(department_id.is.null${deps}))`);
  }
  switch (f.view) {
    case "todas":
      q = q.neq("status", "closed");
      break;
    case "minhas":
      q = q.neq("status", "closed").eq("assigned_to", userId);
      break;
    case "pendentes":
      // Grupos ficam de fora para não encher a fila de quem espera resposta.
      q = q.eq("status", "waiting").eq("contact.is_group", false);
      break;
    case "grupos":
      q = q.neq("status", "closed").eq("contact.is_group", true);
      break;
    case "robo":
      q = q.eq("status", "bot");
      break;
    case "equipe":
      // Em atendimento por outro atendente.
      q = q.eq("status", "open").neq("assigned_to", userId);
      break;
    case "fechadas":
      q = q.eq("status", "closed");
      break;
  }

  if (f.queue === "minhas") q = q.eq("assigned_to", userId);
  else if (f.queue === "departamento") q = q.in("department_id", lk.myDepartments);
  else if (f.queue === "geral") q = q.is("department_id", null);

  if (f.department === "none") q = q.is("department_id", null);
  else if (f.department) q = q.eq("department_id", f.department);

  if (f.stage) q = q.in("contact_id", lk.stageContacts.get(f.stage) ?? []);

  if (lk.searchContacts) {
    const text = cleanSearch(f.search ?? "");
    const ids = lk.searchContacts.length ? `,contact_id.in.(${lk.searchContacts.join(",")})` : "";
    q = q.or(`last_message_preview.ilike.%${text}%${ids}`);
  }
  return q;
}

/** Conversas com o contato junto (inner join, para poder filtrar por grupo). */
export const CONVERSATION_SELECT =
  "*, contact:contacts!inner(*), department:departments(id, name, color), agent:agents(id, name)";

export async function countAll(userId: string, base: InboxFilter) {
  const db = supabaseAdmin();
  const stageKeys = STAGES.map((s) => s.key);
  const lk = await loadLookups(userId, stageKeys);
  const count = async (f: InboxFilter) => {
    const query = db.from("conversations").select("id, contact:contacts!inner(is_group)", { count: "exact", head: true });
    const { count: n, error } = await applyFilter(query, f, userId, lk);
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const keyed = async <K extends string>(keys: readonly K[], make: (k: K) => InboxFilter) =>
    Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await count(make(k))]))) as Record<K, number>;

  // Os números de cada bloco respeitam o que está escolhido nos outros blocos.
  const [views, queues, stages] = await Promise.all([
    keyed(VIEWS, (view) => ({ ...base, view, stage: null })),
    keyed(QUEUES, (queue) => ({ ...base, queue, stage: null })),
    keyed(stageKeys, (stage) => ({ ...base, stage })),
  ]);
  return { views, queues, stages };
}
