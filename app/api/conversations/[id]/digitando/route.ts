import { route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { whatsapp } from "@/lib/whatsapp";

// Atendente digitando: o cliente vê "digitando…" no WhatsApp (a tela chama no máximo a cada 8 segundos).
const ultimo = new Map<string, number>();

export const POST = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  // No máximo um aviso a cada 6 segundos por conversa, mesmo com várias abas abertas.
  if (Date.now() - (ultimo.get(id) ?? 0) < 6000) return;
  ultimo.set(id, Date.now());
  if (ultimo.size > 500) for (const [k, t] of ultimo) if (Date.now() - t > 60_000) ultimo.delete(k);
  const { data } = await supabaseAdmin()
    .from("conversations")
    .select("contact:contacts(phone, is_group), connection:whatsapp_connections(instance, channel)")
    .eq("id", id)
    .maybeSingle();
  const c = data as unknown as { contact: { phone: string; is_group: boolean }; connection: { instance: string; channel?: string } | null } | null;
  if (!c || c.contact.is_group || (c.connection?.channel && c.connection.channel !== "whatsapp")) return;
  const zap = whatsapp(c.connection?.instance);
  // Não espera: o aviso de digitando não pode atrasar nada.
  void zap.digitando?.(c.contact.phone).catch(() => {});
});
