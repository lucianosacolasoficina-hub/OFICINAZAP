import { route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Desconecta o Outlook: apaga o acesso guardado. Os e-mails já trazidos continuam nas conversas.
export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const db = supabaseAdmin();
  await db.from("email_tokens").delete().eq("connection_id", id);
  await db.from("whatsapp_connections").update({ connected_at: null }).eq("id", id).eq("channel", "email");
});
