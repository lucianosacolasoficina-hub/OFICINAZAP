import { runAgent } from "./ai/agent";
import {
  activeConversation,
  addMessage,
  getQuote,
  getSetting,
  mergeQuote,
  recentMessages,
  updateConversation,
  upsertContact,
} from "./db";
import { whatsapp, type IncomingMessage } from "./whatsapp";

// Espera o cliente terminar de digitar várias mensagens seguidas antes de a IA responder.
const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS ?? 4000);

export async function handleIncoming(msg: IncomingMessage) {
  const botEnabled = await getSetting<boolean>("bot_enabled", true);
  const contact = await upsertContact(msg.phone, msg.name);
  const conversation = await activeConversation(contact.id, botEnabled);

  const saved = await addMessage(conversation.id, {
    direction: "in",
    sender: "contact",
    body: msg.text,
    media_type: msg.mediaType ?? null,
    wa_message_id: msg.waMessageId,
  });
  if (!saved || conversation.status !== "bot" || !botEnabled) return;

  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  const history = await recentMessages(conversation.id);
  const latest = history[history.length - 1];
  // Chegou outra mensagem depois desta: quem responde é o processamento dela.
  if (latest && latest.id !== saved.id) return;

  const [knowledgeBase, quote] = await Promise.all([
    getSetting<string>("knowledge_base", ""),
    getQuote(conversation.id),
  ]);
  const result = await runAgent({ history, knowledgeBase, quote });

  for (const fields of result.quoteFields) {
    await mergeQuote(conversation.id, contact.id, fields);
  }
  if (result.reply) {
    const sent = await whatsapp().sendText(contact.phone, result.reply);
    await addMessage(conversation.id, {
      direction: "out",
      sender: "bot",
      body: result.reply,
      wa_message_id: sent.waMessageId ?? null,
    });
  }
  if (result.handoff) {
    await updateConversation(conversation.id, { status: "waiting" });
    await addMessage(conversation.id, {
      direction: "out",
      sender: "system",
      body: `IA transferiu para atendimento humano: ${result.handoff}`,
    });
  }
}
