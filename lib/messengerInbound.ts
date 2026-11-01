import { activeConversation, addMessage, setMessageMedia } from "./db";
import { upsertContact } from "./db";
import { saveMedia } from "./media";
import { supabaseAdmin } from "./supabase/admin";
import { tokenPorConta } from "./instagram";
import { FB_PREFIX, perfilMessenger } from "./messenger";

// Eventos do webhook da Página (Messenger).
type FbAttachment = { type?: string; payload?: { url?: string } };
type FbEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: FbAttachment[] };
};
type FbPayload = { object?: string; entry?: { id?: string; messaging?: FbEvent[] }[] };

const TIPO: Record<string, "image" | "audio" | "video" | "document"> = { image: "image", audio: "audio", video: "video", file: "document" };

async function baixar(url: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return { data: Buffer.from(await r.arrayBuffer()), mimeType: (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0] };
  } catch {
    return null;
  }
}

export async function processarMessenger(payload: FbPayload) {
  if (payload.object !== "page") return;
  for (const entry of payload.entry ?? []) {
    const pagina = String(entry.id ?? "");
    const tk = await tokenPorConta(pagina);
    if (!tk) continue;
    const { data: conn } = await supabaseAdmin().from("whatsapp_connections").select("id, department_id, channel").eq("id", tk.connection_id).maybeSingle();
    if (!conn || conn.channel !== "messenger") continue;
    for (const ev of entry.messaging ?? []) {
      const m = ev.message;
      if (!m?.mid) continue;
      const deMim = !!m.is_echo || ev.sender?.id === pagina;
      const cliente = deMim ? ev.recipient?.id : ev.sender?.id;
      if (!cliente) continue;
      const { data: ja } = await supabaseAdmin().from("messages").select("id").eq("wa_message_id", m.mid).maybeSingle();
      if (ja) continue;

      let contato = await upsertContact(FB_PREFIX + cliente);
      if (!contato.name) {
        const nome = await perfilMessenger(tk.access_token, cliente);
        if (nome) {
          const { data } = await supabaseAdmin().from("contacts").update({ name: nome }).eq("id", contato.id).select().single();
          if (data) contato = data;
        }
      }
      const conversa = await activeConversation(contato.id, false, conn);
      const anexo = m.attachments?.[0];
      const tipo = anexo?.type ? TIPO[anexo.type] : undefined;
      const salvo = await addMessage(conversa.id, {
        direction: deMim ? "out" : "in",
        sender: deMim ? "agent" : "contact",
        body: m.text ?? "",
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
