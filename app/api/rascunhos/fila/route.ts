import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { esperar } from "@/lib/rascunhosAoVivo";

// O OficinaZap aberto fica esperando aqui (até 25 s por vez) os rascunhos que o sistema de gestão
// deixar para este atendente. Também serve de "estou aberto" para o sistema não abrir outra janela.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await currentUser();
  const email = u?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const w = Math.min(25, Math.max(0, Number(new URL(req.url).searchParams.get("wait") ?? "25") || 0));
  const itens = await esperar(email, w * 1000);
  return NextResponse.json({ itens }, { headers: { "Cache-Control": "no-store" } });
}
