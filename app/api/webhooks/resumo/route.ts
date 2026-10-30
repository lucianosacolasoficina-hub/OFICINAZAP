import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Resumo público (só números) para o sistema de gestão mostrar o WhatsApp em destaque.
// Não expõe nomes nem mensagens.
const ORIGENS = ["https://sistema.sacolasoficina.com.br", "https://sacolasoficina.onrender.com"];

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : ORIGENS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function GET(req: Request) {
  const db = supabaseAdmin();
  const [aguardando, robo, abertas, naoLidas] = await Promise.all([
    db.from("conversations").select("id", { count: "exact", head: true }).eq("status", "waiting"),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("status", "bot"),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("conversations").select("id", { count: "exact", head: true }).neq("status", "closed").gt("unread_count", 0),
  ]);
  return NextResponse.json(
    {
      aguardando: aguardando.count ?? 0,
      robo: robo.count ?? 0,
      emAtendimento: abertas.count ?? 0,
      naoLidas: naoLidas.count ?? 0,
      em: new Date().toISOString(),
    },
    { headers: cors(req) },
  );
}
