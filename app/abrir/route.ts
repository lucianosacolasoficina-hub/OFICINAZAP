import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone, phoneVariants } from "@/lib/phone";
import { publicUrl } from "@/lib/origin";

// Atalho vindo do sistema de gestão (agenda, ficha do cliente): /abrir?tel=77999998888&nome=Fulano
// Abre a conversa do cliente no OficinaZap; se ainda não existe, abre "Nova conversa" já com o número.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const tel = normalizePhone(u.searchParams.get("tel") ?? "");
  const nome = (u.searchParams.get("nome") ?? "").slice(0, 80);
  if (!(await currentUser())) return NextResponse.redirect(publicUrl(req, "/login"));
  if (!tel) return NextResponse.redirect(publicUrl(req, "/"));
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
    if (conv) return NextResponse.redirect(publicUrl(req, `/?c=${conv.id}`));
  }
  const q = new URLSearchParams({ novo: tel });
  if (nome) q.set("nome", nome);
  return NextResponse.redirect(publicUrl(req, `/?${q}`));
}
