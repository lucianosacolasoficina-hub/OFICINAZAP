import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone, phoneVariants } from "@/lib/phone";
import { publicUrl } from "@/lib/origin";

// Atalho vindo do sistema de gestão (agenda, ficha do cliente, proposta, pedido…):
//   /abrir?tel=77999998888&nome=Fulano[&r=<id do rascunho>]
// Abre a conversa do cliente no OficinaZap; se ainda não existe, abre "Nova conversa" já com o número.
// Com r=, a mensagem (texto + PDF) deixada pelo sistema aparece pronta na caixa de resposta, só para enviar.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const tel = normalizePhone(u.searchParams.get("tel") ?? "");
  const nome = (u.searchParams.get("nome") ?? "").slice(0, 80);
  const r = (u.searchParams.get("r") ?? "").replace(/[^0-9a-f-]/g, "").slice(0, 36);
  if (!(await currentUser())) return NextResponse.redirect(publicUrl(req, "/login"));
  const q = new URLSearchParams();
  if (r) q.set("r", r);
  if (!tel) return NextResponse.redirect(publicUrl(req, r ? `/?${q}` : "/"));
  const db = supabaseAdmin();
  const { data: cts } = await db.from("contacts").select("id").in("phone", phoneVariants(tel)).eq("is_group", false);
  const ids = (cts ?? []).map((c) => c.id as string);
  if (ids.length) {
    const { data: convs } = await db
      .from("conversations")
      .select("id, status, last_message_at")
      .in("contact_id", ids)
      .order("last_message_at", { ascending: false })
      .limit(10);
    const conv = (convs ?? []).find((c) => c.status !== "closed") ?? (convs ?? [])[0];
    if (conv) {
      q.set("c", conv.id);
      return NextResponse.redirect(publicUrl(req, `/?${q}`));
    }
  }
  q.set("novo", tel);
  if (nome) q.set("nome", nome);
  return NextResponse.redirect(publicUrl(req, `/?${q}`));
}
