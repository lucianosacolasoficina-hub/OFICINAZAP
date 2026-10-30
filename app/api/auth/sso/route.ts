import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

// Entrada pelo sistema de gestão: quem já está logado lá entra direto aqui, sem digitar senha.
// O sistema envia (POST) o token da sessão dele; conferimos esse token no Supabase do sistema
// e abrimos a sessão do atendente que tem o mesmo e-mail no OficinaZap.
const volta = (req: Request, motivo: string) =>
  NextResponse.redirect(publicUrl(req, `/login?sso=${motivo}`), { status: 303 });

export async function POST(req: Request) {
  const url = process.env.GESTAO_SUPABASE_URL, anon = process.env.GESTAO_SUPABASE_ANON_KEY;
  if (!url || !anon) return volta(req, "indisponivel");
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  if (!token) return volta(req, "sessao");

  const r = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) return volta(req, "sessao");
  const gestaoUser = (await r.json()) as { email?: string };
  const email = gestaoUser.email?.trim().toLowerCase();
  if (!email) return volta(req, "sessao");

  const admin = supabaseAdmin();
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = lista?.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) return volta(req, "sem-acesso");
  const { data: agent } = await admin.from("agents").select("active").eq("id", user.id).maybeSingle();
  if (agent && agent.active === false) return volta(req, "desativado");

  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link?.properties?.hashed_token) return volta(req, "indisponivel");
  const supabase = await supabaseServer();
  const { error: e2 } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (e2) return volta(req, "indisponivel");
  return NextResponse.redirect(publicUrl(req, "/"), { status: 303 });
}
