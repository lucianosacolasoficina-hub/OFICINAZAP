import { OPEN_STAGES, type Deal } from "./stages";
import { supabaseAdmin } from "./supabase/admin";

export { isStage } from "./stages";

/** Cria um negócio em "Novo lead" para o contato, se ele ainda não tiver um em andamento. */
export async function ensureDeal(contactId: string, conversationId: string, title: string): Promise<Deal> {
  const db = supabaseAdmin();
  const { data: existing, error } = await db
    .from("deals")
    .select("*")
    .eq("contact_id", contactId)
    .in("stage", OPEN_STAGES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing as Deal;

  const { data, error: insertError } = await db
    .from("deals")
    .insert({ contact_id: contactId, conversation_id: conversationId, title, stage: "novo", position: Date.now() })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return data as Deal;
}
