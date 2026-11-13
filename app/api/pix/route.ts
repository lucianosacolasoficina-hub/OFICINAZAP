import { HttpError, route } from "@/lib/api";
import { getPix, textoCobranca } from "@/lib/pix";

// Monta a mensagem de cobrança por Pix (com o "copia e cola") para o atendente revisar e enviar.
export const POST = route(async (req) => {
  const { valor, descricao } = (await req.json()) as { valor?: number | string; descricao?: string };
  const cfg = await getPix();
  if (!cfg.chave) throw new HttpError(400, "a chave Pix da loja ainda não foi cadastrada. Peça para quem cuida das Configurações cadastrar em Configurações > Pix.");
  const v = typeof valor === "string" ? Number(valor.replace(/\./g, "").replace(",", ".")) : Number(valor ?? 0);
  if (valor !== undefined && valor !== "" && (!Number.isFinite(v) || v < 0 || v > 1_000_000)) throw new HttpError(400, "valor inválido");
  return textoCobranca(cfg, v || undefined, descricao?.trim().slice(0, 60) || undefined);
});
