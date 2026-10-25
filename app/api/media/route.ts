import { NextResponse } from "next/server";
import { signedMediaUrl } from "@/lib/media";
import { currentUser } from "@/lib/supabase/server";

// Abre um arquivo recebido no WhatsApp (link temporário do Storage).
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const path = new URL(req.url).searchParams.get("path");
  if (!path || path.includes("..")) return NextResponse.json({ error: "caminho inválido" }, { status: 400 });
  const url = await signedMediaUrl(path);
  if (!url) return NextResponse.json({ error: "arquivo não encontrado" }, { status: 404 });
  return NextResponse.redirect(url);
}
