import { supabaseAdmin } from "./supabase/admin";

export type Contact = {
  id: string;
  phone: string;
  name: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
};

export type ConversationStatus = "bot" | "waiting" | "open" | "closed";

export type Conversation = {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_to: string | null;
  department_id: string | null;
  unread_count: number;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  sender: "contact" | "bot" | "agent" | "system";
  agent_id: string | null;
  body: string;
  media_type: string | null;
  media_url: string | null;
  wa_message_id: string | null;
  created_at: string;
};

export type Department = {
  id: string;
  name: string;
  description: string;
  color: string;
  active: boolean;
  created_at: string;
};

export type QuoteData = Record<string, string | number | null>;

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function upsertContact(phone: string, name?: string): Promise<Contact> {
  const db = supabaseAdmin();
  const existing = check(await db.from("contacts").select("*").eq("phone", phone).maybeSingle()) as Contact | null;
  if (existing) {
    if (name && !existing.name) {
      return check(await db.from("contacts").update({ name }).eq("id", existing.id).select().single());
    }
    return existing;
  }
  return check(await db.from("contacts").insert({ phone, name: name ?? null }).select().single());
}

/** Devolve a conversa ativa do contato ou abre uma nova (atendida pela IA se ela estiver ligada). */
export async function activeConversation(contactId: string, botEnabled: boolean): Promise<Conversation> {
  const db = supabaseAdmin();
  const open = check(
    await db
      .from("conversations")
      .select("*")
      .eq("contact_id", contactId)
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ) as Conversation | null;
  if (open) return open;
  return check(
    await db
      .from("conversations")
      .insert({ contact_id: contactId, status: botEnabled ? "bot" : "waiting" })
      .select()
      .single(),
  );
}

export async function addMessage(
  conversationId: string,
  msg: Pick<Message, "direction" | "sender" | "body"> &
    Partial<Pick<Message, "agent_id" | "media_type" | "wa_message_id">>,
): Promise<Message | null> {
  const db = supabaseAdmin();
  const res = await db.from("messages").insert({ conversation_id: conversationId, ...msg }).select().single();
  // Mensagem repetida (o provedor reenviou o webhook): ignora.
  if (res.error?.code === "23505") return null;
  const saved = check(res) as Message;

  const conv = check(
    await db.from("conversations").select("unread_count").eq("id", conversationId).single(),
  ) as { unread_count: number };
  const preview = msg.body || (msg.media_type ? `[${msg.media_type}]` : "");
  check(
    await db
      .from("conversations")
      .update({
        last_message_at: saved.created_at,
        last_message_preview: preview.slice(0, 120),
        unread_count: msg.direction === "in" ? conv.unread_count + 1 : conv.unread_count,
      })
      .eq("id", conversationId),
  );
  return saved;
}

export async function setMessageMedia(messageId: string, mediaUrl: string) {
  check(await supabaseAdmin().from("messages").update({ media_url: mediaUrl }).eq("id", messageId));
}

export async function recentMessages(conversationId: string, limit = 40): Promise<Message[]> {
  const db = supabaseAdmin();
  const rows = check(
    await db
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ) as Message[];
  return rows.reverse();
}

export async function updateConversation(id: string, patch: Partial<Conversation>) {
  check(await supabaseAdmin().from("conversations").update(patch).eq("id", id));
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = check(
    await supabaseAdmin().from("settings").select("value").eq("key", key).maybeSingle(),
  ) as { value: T } | null;
  return row ? row.value : fallback;
}

export async function setSetting(key: string, value: unknown) {
  check(await supabaseAdmin().from("settings").upsert({ key, value }));
}

export async function getQuote(conversationId: string): Promise<QuoteData | null> {
  const row = check(
    await supabaseAdmin().from("quotes").select("data").eq("conversation_id", conversationId).maybeSingle(),
  ) as { data: QuoteData } | null;
  return row?.data ?? null;
}

/** Junta os campos novos aos já coletados (campos vazios não apagam os anteriores). */
export async function mergeQuote(conversationId: string, contactId: string, fields: QuoteData) {
  const current = (await getQuote(conversationId)) ?? {};
  const merged: QuoteData = { ...current };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== "") merged[k] = v;
  }
  check(
    await supabaseAdmin()
      .from("quotes")
      .upsert(
        { conversation_id: conversationId, contact_id: contactId, data: merged, updated_at: new Date().toISOString() },
        { onConflict: "conversation_id" },
      ),
  );
  return merged;
}

export async function listDepartments(): Promise<Department[]> {
  return check(await supabaseAdmin().from("departments").select("*").eq("active", true).order("name")) as Department[];
}

/** Manda a conversa para a fila de um departamento (sem atendente definido) e registra no chat. */
export async function transferToDepartment(conversationId: string, department: Department, note?: string, agentId?: string) {
  await updateConversation(conversationId, { department_id: department.id, status: "waiting", assigned_to: null });
  await addMessage(conversationId, {
    direction: "out",
    sender: "system",
    body: `Conversa transferida para ${department.name}${note ? `: ${note}` : ""}`,
    agent_id: agentId ?? null,
  });
}
