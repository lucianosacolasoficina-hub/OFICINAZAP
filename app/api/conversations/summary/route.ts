import { route } from "@/lib/api";
import { countAll, parseFilter } from "@/lib/inbox";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Contadores do lado esquerdo da tela de conversas e os números de WhatsApp (para iniciar conversa).
export const GET = route(async (req, _ctx, userId) => {
  const filter = parseFilter(new URL(req.url).searchParams);
  const [counts, connections] = await Promise.all([
    countAll(userId, filter),
    supabaseAdmin().from("whatsapp_connections").select("id, name, connected_at").order("created_at"),
  ]);
  return { ...counts, connections: connections.data ?? [], me: userId };
});
