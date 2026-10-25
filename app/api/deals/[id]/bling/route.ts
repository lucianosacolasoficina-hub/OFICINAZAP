import { route, type IdCtx } from "@/lib/api";
import { sendDealToBling } from "@/lib/bling";

// Envia (ou reenvia, se deu erro antes) o negócio para o Bling como pedido de venda.
export const POST = route<IdCtx>(async (_req, { params }) => {
  const { id } = await params;
  return sendDealToBling(id);
});
