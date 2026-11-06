import { randomUUID } from "node:crypto";
import { HttpError, route } from "@/lib/api";
import { getSetting, setSetting } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Catálogo de produtos da empresa (como o catálogo do WhatsApp Business): nome, preço, descrição e foto.
// Na conversa, um clique coloca a foto e o texto do produto na caixa para o atendente conferir e enviar.
export type ItemCatalogo = { id: string; nome: string; preco: string; descricao: string; foto: string | null; criado: string };

const CHAVE = "catalogo";
const ler = () => getSetting<ItemCatalogo[]>(CHAVE, []).catch(() => [] as ItemCatalogo[]);

export const GET = route(async () => ler());

export const POST = route(async (req) => {
  const b = (await req.json()) as { id?: string; nome?: string; preco?: string; descricao?: string; foto?: { data?: string; mimeType?: string } | null };
  const nome = String(b.nome ?? "").trim().slice(0, 120);
  if (!nome) throw new HttpError(400, "dê um nome ao produto");
  const itens = await ler();
  const antigo = b.id ? itens.find((i) => i.id === b.id) : undefined;
  const item: ItemCatalogo = {
    id: antigo?.id ?? randomUUID(),
    nome,
    preco: String(b.preco ?? "").trim().slice(0, 60),
    descricao: String(b.descricao ?? "").trim().slice(0, 1500),
    foto: antigo?.foto ?? null,
    criado: antigo?.criado ?? new Date().toISOString(),
  };
  if (b.foto?.data) {
    const mime = b.foto.mimeType ?? "";
    if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw new HttpError(400, "foto em PNG, JPG ou WEBP");
    const data = Buffer.from(b.foto.data, "base64");
    if (data.length > 5 * 1024 * 1024) throw new HttpError(400, "foto muito grande (máximo 5 MB)");
    const path = `catalogo/${item.id}-${Date.now()}.${mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1]}`;
    const { error } = await supabaseAdmin().storage.from("media").upload(path, data, { contentType: mime, upsert: true });
    if (error) throw new Error(error.message);
    if (antigo?.foto) await supabaseAdmin().storage.from("media").remove([antigo.foto]).catch(() => {});
    item.foto = path;
  } else if (b.foto === null && antigo?.foto) {
    await supabaseAdmin().storage.from("media").remove([antigo.foto]).catch(() => {});
    item.foto = null;
  }
  const novos = antigo ? itens.map((i) => (i.id === item.id ? item : i)) : [...itens, item];
  await setSetting(CHAVE, novos);
  return item;
});

export const DELETE = route(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  const itens = await ler();
  const it = itens.find((i) => i.id === id);
  if (!it) throw new HttpError(404, "produto não encontrado");
  if (it.foto) await supabaseAdmin().storage.from("media").remove([it.foto]).catch(() => {});
  await setSetting(CHAVE, itens.filter((i) => i.id !== id));
});
