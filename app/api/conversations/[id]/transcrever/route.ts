import { HttpError, route, type IdCtx } from "@/lib/api";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { transcreverMensagem } from "@/lib/transcrever";

// Transcreve um áudio da conversa (o acesso à conversa já é conferido em route()).
export const POST = route(async (req, ctx: IdCtx) => {
  const { id } = await ctx.params;
  const { msg } = (await req.json()) as { msg?: string };
  if (!msg || !/^[0-9a-f-]{36}$/.test(msg)) throw new HttpError(400, "mensagem inválida");
  const { data: m } = await supabaseAdmin()
    .from("messages")
    .select("id, conversation_id, media_type, media_url, wa_message_id, transcricao")
    .eq("id", msg)
    .eq("conversation_id", id)
    .maybeSingle();
  if (!m) throw new HttpError(404, "mensagem não encontrada");
  if (m.media_type !== "audio") throw new HttpError(400, "esta mensagem não é um áudio");
  try {
    return { texto: await transcreverMensagem(m) };
  } catch (err) {
    throw new HttpError(422, (err as Error).message);
  }
});
