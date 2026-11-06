import { createDecipheriv, hkdfSync } from "node:crypto";
import { setMessageMedia } from "./db";
import { saveMedia } from "./media";
import { supabaseAdmin } from "./supabase/admin";
import { EvolutionProvider } from "./whatsapp/evolution";
import type { MediaFile } from "./whatsapp";

// Anexos (fotos, áudios, vídeos, documentos) das mensagens que entraram sem o arquivo:
// histórico importado e mensagens enviadas pelo celular. Baixa aos poucos, das mais novas para as mais antigas.
// Primeiro tenta direto no servidor de arquivos do WhatsApp (o arquivo vem cifrado e a chave está na própria
// mensagem), sem pedir nada à Evolution. Só se o link já expirou pede à Evolution, que solicita o reenvio ao celular.

const LIMITE = 15 * 1024 * 1024;
const TIPOS: Record<string, [campo: string, info: string]> = {
  image: ["imageMessage", "WhatsApp Image Keys"],
  sticker: ["stickerMessage", "WhatsApp Image Keys"],
  video: ["videoMessage", "WhatsApp Video Keys"],
  audio: ["audioMessage", "WhatsApp Audio Keys"],
  document: ["documentMessage", "WhatsApp Document Keys"],
};

type Midia = { url?: string; directPath?: string; mediaKey?: string; mimetype?: string; fileLength?: number | { low?: number } };
type Pendente = { id: string; conversation_id: string; media_type: string; wa_message_id: string; instance: string | null; aberta: boolean | null; message: Record<string, unknown> | null };

function midiaDa(message: Record<string, unknown> | null, tipo: string): Midia | null {
  const campo = TIPOS[tipo]?.[0];
  if (!message || !campo) return null;
  // Documento com legenda vem embrulhado.
  const doc = (message.documentWithCaptionMessage as { message?: Record<string, unknown> } | undefined)?.message;
  return ((message[campo] ?? doc?.[campo]) as Midia | undefined) ?? null;
}

/** O link do arquivo traz a data de validade (oe=, em hexadecimal). Vencido, o WhatsApp responde 403/404. */
function linkVencido(m: Midia) {
  const oe = /[?&]oe=([0-9a-fA-F]+)/.exec(m.directPath ?? m.url ?? "")?.[1];
  return !!oe && parseInt(oe, 16) * 1000 < Date.now();
}

const tamanho = (m: Midia) => Number(typeof m.fileLength === "object" ? m.fileLength?.low : m.fileLength) || 0;

/** Baixa do servidor do WhatsApp e decifra (padrão do WhatsApp: HKDF-SHA256 + AES-256-CBC). */
async function baixarDireto(m: Midia, tipo: string): Promise<MediaFile | null> {
  if (!m.mediaKey) return null;
  const url = m.url?.includes("mmg.whatsapp.net") ? m.url : m.directPath ? `https://mmg.whatsapp.net${m.directPath}` : null;
  if (!url) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return null; // link expirado (404/410)
  const enc = Buffer.from(await res.arrayBuffer());
  if (enc.length <= 10) return null;
  const chave = Buffer.from(hkdfSync("sha256", Buffer.from(m.mediaKey, "base64"), Buffer.alloc(32), TIPOS[tipo][1], 112));
  const decifra = createDecipheriv("aes-256-cbc", chave.subarray(16, 48), chave.subarray(0, 16));
  const data = Buffer.concat([decifra.update(enc.subarray(0, enc.length - 10)), decifra.final()]);
  return { data, mimeType: m.mimetype?.split(";")[0] || "application/octet-stream" };
}

let rodando = false;

/** Baixa até `n` anexos que faltam. Devolve quantos guardou. */
export async function baixarMidiasPendentes(n = 15) {
  if (rodando) return 0;
  rodando = true;
  const db = supabaseAdmin();
  let ok = 0;
  try {
    const { data, error } = await db.rpc("zap_midias_pendentes", { p_limite: n });
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as Pendente[]) {
      let file: MediaFile | null = null;
      let desistir = false;
      try {
        const m = midiaDa(p.message, p.media_type);
        if (!m) desistir = true; // a Evolution não guardou essa mensagem
        else if (tamanho(m) > LIMITE) desistir = true; // grande demais para guardar
        else if (linkVencido(m)) desistir = true; // o WhatsApp já apagou do servidor: só existe no celular
        else {
          file = await baixarDireto(m, p.media_type).catch(() => null);
          // Pela Evolution só arquivos pequenos (ela segura o arquivo inteiro na memória).
          if (!file && p.instance && p.aberta && tamanho(m) < 5 * 1024 * 1024) {
            file = await new EvolutionProvider(p.instance)
              .downloadMedia({ mediaRef: p.wa_message_id } as Parameters<EvolutionProvider["downloadMedia"]>[0])
              .catch(() => null);
            // Pausa: esse caminho pesa na Evolution.
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        const path = file && (await saveMedia(p.conversation_id, p.id, file));
        if (path) {
          await setMessageMedia(p.id, path);
          ok++;
          continue;
        }
      } catch (err) {
        console.error("anexo antigo", p.wa_message_id, (err as Error).message);
      }
      // Não conseguiu: tenta de novo mais tarde (até 3 vezes) ou desiste de vez.
      const { data: atual } = await db.from("messages").select("media_tentativas").eq("id", p.id).single();
      await db.from("messages").update({ media_tentativas: desistir ? 9 : (atual?.media_tentativas ?? 0) + 1 }).eq("id", p.id);
    }
  } catch (err) {
    console.error("anexos pendentes", err);
  } finally {
    rodando = false;
  }
  if (ok) console.log(`Anexos baixados: ${ok}`);
  return ok;
}
