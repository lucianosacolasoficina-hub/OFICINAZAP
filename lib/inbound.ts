import { isAgentImageType, runAgent, type AgentImage } from "./ai/agent";
import { connectionByInstance, listConnections } from "./connections";
import { ensureDeal } from "./deals";
import {
  activeConversation,
  addMessage,
  aplicarReacao,
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
  upsertGroup,
} from "./db";
import { consultarGestao, gestaoAtiva, resumoParaIA } from "./gestao";
import { loadMedia, saveMedia } from "./media";
import { transcreverMensagem, transcricaoLigada } from "./transcrever";
import { whatsapp, type IncomingMessage } from "./whatsapp";
import { avisarMaster, getLimites } from "./whatsapp/trava";
import { supabaseAdmin } from "./supabase/admin";

// Espera o cliente terminar de digitar várias mensagens seguidas antes de a IA responder.
const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS ?? 4000);

/** `robo: false` = só guarda a mensagem (usado na conferência para mensagens que já não são recentes). */
export async function handleIncoming(msg: IncomingMessage, opts: { robo?: boolean } = {}) {
  // Reação do cliente (emoji numa mensagem): só marca a mensagem reagida, não vira balão nem acorda a IA.
  if (msg.reacao) {
    await aplicarReacao(msg.reacao.alvo, "cliente", msg.reacao.emoji);
    return;
  }
  const botEnabled = await getSetting<boolean>("bot_enabled", true);
  // Com vários números, a conversa fica ligada ao número que recebeu a mensagem e a resposta sai por ele.
  const connection = msg.instance ? await connectionByInstance(msg.instance) : null;
  const instance = connection?.instance ?? msg.instance;
  const contact = msg.isGroup ? await groupContact(msg.phone, instance) : await upsertContact(msg.phone, msg.name);
  // A IA não responde em grupos: a conversa já abre esperando um atendente.
  const conversation = await activeConversation(contact.id, botEnabled && !msg.isGroup, connection);

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
      // Áudio do cliente já vira texto (quando a transcrição está ligada).
      if (path && msg.mediaType === "audio" && transcricaoLigada()) {
        transcreverMensagem({ ...saved, media_url: path }).catch((err) => console.error("Falha ao transcrever", msg.waMessageId, err));
      }
    } catch (err) {
      console.error("Falha ao baixar mídia", msg.waMessageId, err);
    }
  }

  if (conversation.status !== "bot" || !botEnabled) return;
  if (opts.robo === false) {
    await updateConversation(conversation.id, { status: "waiting" });
    return;
  }
  // Mensagem de outro número da própria empresa: o robô nunca responde (um robô respondendo o outro vira ciclo sem fim).
  if (!msg.isGroup && (await ehNumeroDaEmpresa(contact.phone))) {
    await updateConversation(conversation.id, { status: "waiting" });
    return;
  }

  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  const history = await recentMessages(conversation.id);
  const latest = history[history.length - 1];
  // Chegou outra mensagem depois desta: quem responde é o processamento dela.
  if (latest && latest.id !== saved.id) return;

  // Robô respondendo demais na mesma conversa (o outro lado pode ser outro robô): para e chama um atendente.
  const limites = await getLimites();
  const { count: respostas } = await supabaseAdmin()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("sender", "bot")
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if ((respostas ?? 0) >= limites.robo_10min) {
    await pararRobo(conversation.id, `IA parou: já respondeu ${respostas} vezes em 10 minutos nesta conversa (pode ser outro robô do outro lado). Um atendente precisa assumir.`);
    await avisarMaster(instance ?? "", `IA parou na conversa com ${contact.name || contact.phone}: ${respostas} respostas em 10 minutos (possível conversa robô com robô)`);
    return;
  }

  const [knowledgeBase, quote, departments] = await Promise.all([
    getSetting<string>("knowledge_base", ""),
    getQuote(conversation.id),
    listDepartments(),
  ]);
  // Dados do cliente no sistema de gestão: a IA responde sobre pedidos e prazos.
  let gestao: string | undefined;
  // A IA só responde sobre pedidos se GESTAO_IA=1. Por enquanto a posição do pedido é enviada pelo atendente.
  if (gestaoAtiva() && process.env.GESTAO_IA === "1" && !msg.isGroup) {
    try {
      gestao = resumoParaIA(await consultarGestao({ telefone: contact.phone }));
    } catch (err) {
      console.error("Falha ao consultar o sistema de gestão", err);
    }
  }
  const result = await runAgent({
    history,
    knowledgeBase,
    quote,
    departments,
    images: await recentImages(history),
    gestao,
    consultarPedido: gestao
      ? async (numero) => resumoParaIA(await consultarGestao({ telefone: contact.phone, pedido: numero.replace(/\D/g, "") }))
      : undefined,
  });

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
    let sent: { waMessageId?: string };
    try {
      sent = await whatsapp(instance).sendText(contact.phone, result.reply);
    } catch (err) {
      // Trava de envio (envio em massa, mensagem repetida) ou falha da Evolution: um atendente assume.
      await pararRobo(conversation.id, `IA não enviou a resposta: ${err instanceof Error ? err.message : "falha no envio"}`);
      return;
    }
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

async function pararRobo(conversationId: string, motivo: string) {
  await updateConversation(conversationId, { status: "waiting" });
  await addMessage(conversationId, { direction: "out", sender: "system", body: motivo });
}

// Números conectados no OficinaZap (guardados por 1 minuto).
let numerosCache: { t: number; v: string[] } | null = null;
async function ehNumeroDaEmpresa(phone: string) {
  if (!numerosCache || Date.now() - numerosCache.t > 60_000) {
    const conns = await listConnections().catch(() => []);
    numerosCache = { t: Date.now(), v: conns.map((c) => (c.phone ?? "").replace(/\D/g, "")).filter((p) => p.length >= 8) };
  }
  // Compara os 8 últimos dígitos (o 9 extra do celular pode vir ou não).
  const fim = phone.replace(/\D/g, "").slice(-8);
  return fim.length === 8 && numerosCache.v.some((p) => p.slice(-8) === fim);
}

/** Contato do grupo; na primeira mensagem busca o nome do grupo no WhatsApp. */
async function groupContact(groupId: string, instance?: string) {
  const contact = await upsertGroup(groupId);
  if (contact.name) return contact;
  const name = await whatsapp(instance)
    .groupName?.(groupId)
    .catch(() => null);
  return name ? upsertGroup(groupId, name) : contact;
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
