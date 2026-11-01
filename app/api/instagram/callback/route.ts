import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { getAgent } from "@/lib/perms";
import { assinarWebhook, getIgConfig, gravarConexao, trocarCodigo, igUrl } from "@/lib/instagram";
import { publicUrl } from "@/lib/origin";

// Volta da autorização do Instagram: guarda o token e cria a "conexão" Instagram no OficinaZap.
export async function GET(req: NextRequest) {
  const volta = (q: string) => {
    const r = NextResponse.redirect(publicUrl(req, `/whatsapp?ig=${q}`));
    r.cookies.delete("ig_state");
    return r;
  };
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return volta("cancelado");
  const user = await currentUser();
  const agent = user ? await getAgent(user.id) : null;
  if (!agent || agent.role !== "admin") return volta("sem-permissao");
  if (!p.get("state") || p.get("state") !== req.cookies.get("ig_state")?.value) return volta("expirou");
  const code = p.get("code");
  if (!code) return volta("cancelado");
  try {
    const cfg = await getIgConfig();
    const r = await trocarCodigo(cfg, code, igUrl("/api/instagram/callback"));
    await gravarConexao(r);
    await assinarWebhook(r.token, r.igUserId);
    return volta("ok");
  } catch (err) {
    console.error("Erro ao conectar Instagram", err);
    return volta(`erro&msg=${encodeURIComponent((err as Error).message.slice(0, 400))}`);
  }
}
