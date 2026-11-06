import { NextResponse } from "next/server";
import { getSetting } from "@/lib/db";
import { signedMediaUrl } from "@/lib/media";
import { getAgent } from "@/lib/perms";
import { currentUser } from "@/lib/supabase/server";
import type { ItemCatalogo } from "../route";

// Foto de um produto do catálogo: só as fotos cadastradas no catálogo, achadas pelo id do produto.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const agent = await getAgent(user.id);
  if (agent && !agent.active) return NextResponse.json({ error: "acesso desativado" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  const itens = await getSetting<ItemCatalogo[]>("catalogo", []).catch(() => [] as ItemCatalogo[]);
  const foto = itens.find((i) => i.id === id)?.foto;
  const url = foto ? await signedMediaUrl(foto) : null;
  if (!url) return NextResponse.json({ error: "foto não encontrada" }, { status: 404 });
  return NextResponse.redirect(url);
}
