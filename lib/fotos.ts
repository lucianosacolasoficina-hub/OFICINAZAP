import { supabaseAdmin } from "./supabase/admin";
import { EvolutionProvider } from "./whatsapp/evolution";

// Foto de perfil do WhatsApp do contato. O link do WhatsApp vence em alguns dias: renova a cada 3 dias.
export const RENOVAR_MS = 3 * 864e5;

export async function buscarFoto(ct: { id: string; phone: string; is_group: boolean }) {
  const db = supabaseAdmin();
  let url: string | null = null;
  try {
    const { data: conv } = await db
      .from("conversations")
      .select("connection:whatsapp_connections(instance, channel)")
      .eq("contact_id", ct.id)
      .not("connection_id", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const conn = (conv?.connection ?? null) as { instance?: string | null; channel?: string | null } | null;
    if (conn?.instance && (!conn.channel || conn.channel === "whatsapp")) {
      const phone = String(ct.phone);
      url = await new EvolutionProvider(conn.instance).profilePicture(ct.is_group ? `${phone.replace(/@.*/, "")}@g.us` : phone.replace(/\D/g, ""));
    }
  } catch (e) {
    console.error("foto do contato", e);
  }
  await db.from("contacts").update({ avatar_url: url, avatar_checked_at: new Date().toISOString() }).eq("id", ct.id);
  return url;
}

let rodando = false;
/** Em segundo plano: busca as fotos dos contatos com conversa mais recente que ainda não foram conferidos. */
export async function preencherFotos(limite = 25) {
  if (rodando) return;
  rodando = true;
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from("conversations")
      .select("contact:contacts!inner(id, phone, is_group, avatar_checked_at)")
      .is("contact.avatar_checked_at", null)
      .not("connection_id", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(limite * 3);
    const vistos = new Set<string>();
    let n = 0;
    for (const row of data ?? []) {
      const ct = row.contact as unknown as { id: string; phone: string; is_group: boolean };
      if (!ct || vistos.has(ct.id) || /^(ig|fb|mail):/.test(String(ct.phone))) continue;
      vistos.add(ct.id);
      await buscarFoto(ct);
      if (++n >= limite) break;
    }
  } finally {
    rodando = false;
  }
}
