import { type Deal } from "./stages";
import { etapasAbertas, getEtapas } from "./crm";
import { supabaseAdmin } from "./supabase/admin";


/** Cria um negócio em "Novo lead" para o contato, se ele ainda não tiver um em andamento. */
export async function ensureDeal(contactId: string, conversationId: string, title: string): Promise<Deal | null> {
  const db = supabaseAdmin();
  const primeira = (await getEtapas())[0]?.key;
  if (!primeira) return null; // CRM sem etapas: não cria negócio
  const abertas = await etapasAbertas();
  const { data: existing, error } = await db
    .from("deals")
    .select("*")
    .eq("contact_id", contactId)
    .in("stage", abertas.length ? abertas : [primeira])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing as Deal;

  const { data, error: insertError } = await db
    .from("deals")
    .insert({ contact_id: contactId, conversation_id: conversationId, title, stage: primeira, position: Date.now() })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return data as Deal;
}
