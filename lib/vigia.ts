import { listConnections } from "./connections";
import { getSetting, setSetting } from "./db";
import { supabaseAdmin } from "./supabase/admin";
import { EvolutionProvider } from "./whatsapp/evolution";
import { avisarMaster } from "./whatsapp/trava";

// Vigia dos números do WhatsApp. Depois de um reinício do banco ou do servidor, a ligação de um número
// pode travar por dentro da Evolution: ele continua "conectado", mas não envia nem recebe nada.
// A cada 5 minutos testa cada número de verdade (uma consulta que passa pelo WhatsApp).
// Travado: avisa em vermelho no topo e, se houver o link de reinício do Render (EVOLUTION_RESTART_HOOK),
// reinicia o servidor da Evolution sozinho (no máximo uma vez a cada 30 minutos).
// Conectado mas sem nenhuma mensagem há horas no horário comercial: avisa para ler o QR Code de novo.

export type EstadoVigia = { estado: "ok" | "travado" | "mudo"; desde: string; motivo?: string };
const CHAVE = "vigia_whatsapp";
const MUDO_HORAS = 3;
const ENTRE_REINICIOS = 30 * 60_000;

export async function lerVigia(): Promise<Record<string, EstadoVigia>> {
  return getSetting<Record<string, EstadoVigia>>(CHAVE, {}).catch(() => ({}));
}

/** Horário comercial em Brasília: segunda a sábado, 8h às 18h. */
function horarioComercial(agora = new Date()) {
  const br = new Date(agora.getTime() - 3 * 3600_000);
  const dia = br.getUTCDay();
  const h = br.getUTCHours();
  return dia >= 1 && dia <= 6 && h >= 8 && h < 18;
}

async function testar(instance: string): Promise<"ok" | "travado" | "fechado"> {
  const p = new EvolutionProvider(instance);
  const state = await p.connectionState().catch(() => "erro");
  if (state !== "open") return "fechado";
  const fone = await p.ownerPhone();
  if (!fone) return "ok";
  const r = await p.testarSessao(fone);
  return r ? "ok" : "travado";
}

let rodando = false;
export async function vigiarNumeros() {
  if (rodando) return;
  rodando = true;
  try {
    const antes = await lerVigia();
    const agora: Record<string, EstadoVigia> = {};
    let algumTravado = false;
    const conns = (await listConnections()).filter((c) => (c.channel ?? "whatsapp") === "whatsapp" && c.connected_at);
    for (const c of conns) {
      const t = await testar(c.instance).catch(() => "ok" as const);
      if (t === "fechado") continue; // desconectado de verdade: o card já mostra "Ler QR Code"
      let estado: EstadoVigia["estado"] = t === "travado" ? "travado" : "ok";
      let motivo: string | undefined;
      if (estado === "travado") {
        algumTravado = true;
        motivo = `O número ${c.name} aparece conectado, mas está travado: não envia nem recebe.`;
      } else if (horarioComercial()) {
        const { data } = await supabaseAdmin().rpc("zap_ultima_mensagem", { p_instance: c.instance });
        const ultima = data ? new Date(data as string).getTime() : 0;
        const conectadoHa = Date.now() - new Date(c.connected_at!).getTime();
        if (Date.now() - ultima > MUDO_HORAS * 3600_000 && conectadoHa > MUDO_HORAS * 3600_000) {
          estado = "mudo";
          motivo = `O número ${c.name} não recebe nem envia nenhuma mensagem há mais de ${MUDO_HORAS} horas. Se o celular está recebendo normalmente, use Desconectar e Ler QR Code de novo no card.`;
        }
      }
      const anterior = antes[c.id];
      agora[c.id] = { estado, desde: anterior?.estado === estado ? anterior.desde : new Date().toISOString(), motivo };
      if (motivo && anterior?.estado !== estado) await avisarMaster(c.instance, motivo);
    }
    await setSetting(CHAVE, agora);
    if (algumTravado) await reiniciarEvolution();
  } catch (err) {
    console.error("vigia dos números", err);
  } finally {
    rodando = false;
  }
}

async function reiniciarEvolution() {
  const hook = process.env.EVOLUTION_RESTART_HOOK;
  if (!hook) return;
  const ultimo = await getSetting<number>("vigia_ultimo_reinicio", 0).catch(() => 0);
  if (Date.now() - ultimo < ENTRE_REINICIOS) return;
  await setSetting("vigia_ultimo_reinicio", Date.now());
  const res = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  console.warn("Vigia: número travado, reiniciando a Evolution", res?.status);
  await avisarMaster("vigia", "Um número estava travado e o servidor do WhatsApp foi reiniciado sozinho. Em 3 minutos deve voltar.");
}
