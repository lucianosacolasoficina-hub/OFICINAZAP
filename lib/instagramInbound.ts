import { activeConversation, addMessage, setMessageMedia, upsertContact } from "./db";
import { saveMedia } from "./media";
import { supabaseAdmin } from "./supabase/admin";
import { IG_PREFIX, perfil, tokenPorConta } from "./instagram";

// Eventos do webhook do Instagram (mensagens do Direct).
type IgAttachment = { type?: string; payload?: { url?: string } };
type IgEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; attachments?: IgAttachment[] };
};
type IgPayload = { object?: string; entry?: { id?: string; time?: number; messaging?: IgEvent[] }[] };

const TIPO: Record<string, "image" | "audio" | "video" | "document" | "sticker"> = {
  image: "image",
  audio: "audio",
  video: "video",
  file: "document",
  ig_reel: "video",
  reel: "video",
  animated_image: "image",
};

async function baixar(url: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return { data: Buffer.from(await r.arrayBuffer()), mimeType: (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0] };
  } catch {
    return null;
  }
}

export async function processarInstagram(payload: IgPayload) {
  if (payload.object !== "instagram") return;
  for (const entry of payload.entry ?? []) {
    const minhaConta = String(entry.id ?? "");
    const tk = await tokenPorConta(minhaConta);
    if (!tk) continue;
    const { data: conn } = await supabaseAdmin().from("whatsapp_connections").select("id, department_id").eq("id", tk.connection_id).maybeSingle();
    if (!conn) continue;
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m?.mid || m.is_deleted) continue;
      const deMim = !!m.is_echo || ev.sender?.id === minhaConta;
      const cliente = deMim ? ev.recipient?.id : ev.sender?.id;
      if (!cliente) continue;
      // Mensagem que já está guardada (ex.: enviada pelo OficinaZap): não duplica.
      const { data: ja } = await supabaseAdmin().from("messages").select("id").eq("wa_message_id", m.mid).maybeSingle();
      if (ja) continue;

      let contato = await upsertContact(IG_PREFIX + cliente);
      if (!contato.name) {
        const p = await perfil(tk.access_token, cliente);
        const nome = p.name || (p.username ? `@${p.username}` : null);
        if (nome) {
          const { data } = await supabaseAdmin().from("contacts").update({ name: nome }).eq("id", contato.id).select().single();
          if (data) contato = data;
        }
      }
      const conversa = await activeConversation(contato.id, false, conn);
      const anexo = m.attachments?.[0];
      const tipo = anexo?.type ? TIPO[anexo.type] : undefined;
      const texto = m.text ?? (anexo?.type === "share" || anexo?.type === "story_mention" ? `[${anexo.type === "share" ? "publicação compartilhada" : "menção nos stories"}] ${anexo.payload?.url ?? ""}`.trim() : "");
      const salvo = await addMessage(conversa.id, {
        direction: deMim ? "out" : "in",
        sender: deMim ? "agent" : "contact",
        body: texto,
        media_type: tipo ?? null,
        wa_message_id: m.mid,
      });
      if (salvo && tipo && anexo?.payload?.url) {
        const arq = await baixar(anexo.payload.url);
        if (arq) {
          const path = await saveMedia(conversa.id, salvo.id, arq).catch(() => null);
          if (path) await setMessageMedia(salvo.id, path);
        }
      }
    }
  }
}
