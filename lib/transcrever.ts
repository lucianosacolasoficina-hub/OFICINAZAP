import { setMessageMedia } from "./db";
import { loadMedia } from "./media";
import { buscarMidiaFaltando } from "./midiaFaltando";
import { supabaseAdmin } from "./supabase/admin";

// Transcrição dos áudios (voz → texto) com Whisper. Funciona com a chave da Groq (GROQ_API_KEY)
// ou da OpenAI (OPENAI_API_KEY), as duas têm o mesmo formato de pedido.

function servico() {
  if (process.env.GROQ_API_KEY) {
    return { url: "https://api.groq.com/openai/v1/audio/transcriptions", key: process.env.GROQ_API_KEY, model: "whisper-large-v3-turbo" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { url: "https://api.openai.com/v1/audio/transcriptions", key: process.env.OPENAI_API_KEY, model: "whisper-1" };
  }
  return null;
}

export function transcricaoLigada() {
  return !!servico();
}

type Linha = { id: string; conversation_id: string; media_type: string | null; media_url: string | null; wa_message_id: string | null; transcricao?: string | null };

const emAndamento = new Map<string, Promise<string>>();

/** Transcreve o áudio da mensagem (uma vez só) e guarda o texto. */
export function transcreverMensagem(m: Linha): Promise<string> {
  if (m.transcricao) return Promise.resolve(m.transcricao);
  const ja = emAndamento.get(m.id);
  if (ja) return ja;
  const p = (async () => {
    const s = servico();
    if (!s) throw new Error("a transcrição de áudio ainda não foi ligada (falta a chave do serviço)");
    const path = m.media_url ?? (await buscarMidiaFaltando(m));
    if (path && !m.media_url) await setMessageMedia(m.id, path).catch(() => {});
    const file = path && (await loadMedia(path));
    if (!file) throw new Error("o WhatsApp não tem mais este áudio");
    const ext = file.mimeType.includes("mpeg") ? "mp3" : file.mimeType.includes("mp4") ? "m4a" : "ogg";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file.data)], { type: file.mimeType }), `audio.${ext}`);
    form.append("model", s.model);
    form.append("language", "pt");
    form.append("response_format", "json");
    const r = await fetch(s.url, { method: "POST", headers: { Authorization: `Bearer ${s.key}` }, body: form, signal: AbortSignal.timeout(90_000) });
    if (!r.ok) throw new Error(`transcrição falhou (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const texto = String(((await r.json()) as { text?: string }).text ?? "").trim() || "(áudio sem fala)";
    await supabaseAdmin().from("messages").update({ transcricao: texto }).eq("id", m.id);
    return texto;
  })().finally(() => emAndamento.delete(m.id));
  emAndamento.set(m.id, p);
  return p;
}
