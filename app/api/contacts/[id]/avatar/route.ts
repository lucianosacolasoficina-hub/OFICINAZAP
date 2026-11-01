import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buscarFoto, RENOVAR_MS } from "@/lib/fotos";

// Foto de perfil do WhatsApp do contato (como no celular). Sem foto, responde 404 e a tela mostra as iniciais.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new NextResponse(null, { status: 401 });
  const { id } = await ctx.params;
  const { data: ct } = await supabaseAdmin().from("contacts").select("id, phone, is_group, avatar_url, avatar_checked_at").eq("id", id).maybeSingle();
  if (!ct) return new NextResponse(null, { status: 404 });
  let url = ct.avatar_url as string | null;
  const fresco = ct.avatar_checked_at && Date.now() - new Date(ct.avatar_checked_at).getTime() < RENOVAR_MS;
  if (!fresco && !/^(ig|fb|mail):/.test(String(ct.phone))) url = await buscarFoto(ct as { id: string; phone: string; is_group: boolean });
  if (!url) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=21600" } });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=86400" } });
}
