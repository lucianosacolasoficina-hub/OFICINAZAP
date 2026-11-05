import { HttpError, route, type IdCtx } from "@/lib/api";
import { apagarRascunho, lerRascunho } from "@/lib/rascunhos";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Lê um rascunho deixado pelo sistema de gestão (texto, nome do arquivo e link para abrir o arquivo).
export const GET = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  const r = await lerRascunho(id);
  if (!r) throw new HttpError(404, "esse rascunho não existe mais (já foi enviado ou venceu)");
  let url: string | null = null;
  if (r.arquivo) {
    const { data } = await supabaseAdmin().storage.from("media").createSignedUrl(r.arquivo.path, 3600);
    url = data?.signedUrl ?? null;
  }
  return { id: r.id, texto: r.texto, tel: r.tel, nome: r.nome, arquivo: r.arquivo && { nome: r.arquivo.nome, mimeType: r.arquivo.mimeType, tamanho: r.arquivo.tamanho, url } };
});

// Descarta o rascunho sem enviar.
export const DELETE = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "id inválido");
  await apagarRascunho(id);
  return { ok: true };
});
