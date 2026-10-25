import { isAgentImageType, runAgent, type AgentImage } from "./ai/agent";
import { connectionByInstance } from "./connections";
import { ensureDeal } from "./deals";
import {
  activeConversation,
  addMessage,
  getQuote,
  getSetting,
  listDepartments,
  mergeQuote,
  recentMessages,
  setMessageMedia,
  transferToDepartment,
  updateConversation,
  type Message,
  upsertContact,
} from "./db";
import { loadMedia, saveMedia } from "./media";
import { whatsapp, type IncomingMessage } from "./whatsapp";

// Espera o cliente terminar de digitar várias mensagens seguidas antes de a IA responder.
const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS ?? 4000);

export async function handleIncoming(msg: IncomingMessage) {
  const botEnabled = await getSetting<boolean>("bot_enabled", true);
  // Com vários números, a conversa fica ligada ao número que recebeu a mensagem e a resposta sai por ele.
  const connection = msg.instance ? await connectionByInstance(msg.instance) : null;
  const instance = connection?.instance ?? msg.instance;
  const contact = await upsertContact(msg.phone, msg.name);
  const conversation = await activeConversation(contact.id, botEnabled, connection);

  const saved = await addMessage(conversation.id, {
    direction: "in",
    sender: "contact",
    body: msg.text,
    media_type: msg.mediaType ?? null,
    wa_message_id: msg.waMessageId,
  });
  if (!saved) return;

  if (msg.mediaRef) {
    try {
      const file = await whatsapp(instance).downloadMedia(msg);
      const path = file && (await saveMedia(conversation.id, saved.id, file));
      if (path) await setMessageMedia(saved.id, path);
    } catch (err) {
      console.error("Falha ao baixar mídia", msg.waMessageId, err);
    }
  }

  if (conversation.status !== "bot" || !botEnabled) return;

  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  const history = await recentMessages(conversation.id);
  const latest = history[history.length - 1];
  // Chegou outra mensagem depois desta: quem responde é o processamento dela.
  if (latest && latest.id !== saved.id) return;

  const [knowledgeBase, quote, departments] = await Promise.all([
    getSetting<string>("knowledge_base", ""),
    getQuote(conversation.id),
    listDepartments(),
  ]);
  const result = await runAgent({ history, knowledgeBase, quote, departments, images: await recentImages(history) });

  let merged = quote;
  for (const fields of result.quoteFields) {
    merged = await mergeQuote(conversation.id, contact.id, fields);
  }
  // Cliente pediu orçamento: entra no funil de vendas como "Novo lead".
  if (result.quoteFields.length && merged) {
    const title = [merged.quantidade, merged.produto].filter(Boolean).join(" ") || contact.name || contact.phone;
    await ensureDeal(contact.id, conversation.id, String(title));
  }
  if (result.reply) {
    const sent = await whatsapp(instance).sendText(contact.phone, result.reply);
    await addMessage(conversation.id, {
      direction: "out",
      sender: "bot",
      body: result.reply,
      wa_message_id: sent.waMessageId ?? null,
    });
  }
  const department = result.department && departments.find((d) => d.name === result.department);
  if (result.handoff && department) {
    await transferToDepartment(conversation.id, department, `IA: ${result.handoff}`);
  } else if (result.handoff) {
    await updateConversation(conversation.id, { status: "waiting" });
    await addMessage(conversation.id, {
      direction: "out",
      sender: "system",
      body: `IA transferiu para atendimento humano: ${result.handoff}`,
    });
  }
}

/** Carrega as últimas imagens do cliente para a IA poder vê-las. */
async function recentImages(history: Message[], max = 3) {
  const images = new Map<string, AgentImage>();
  const candidates = history.filter((m) => m.direction === "in" && m.media_type === "image" && m.media_url).slice(-max);
  for (const m of candidates) {
    const file = await loadMedia(m.media_url!);
    if (file && isAgentImageType(file.mimeType)) {
      images.set(m.id, { base64: file.data.toString("base64"), mediaType: file.mimeType });
    }
  }
  return images;
}
