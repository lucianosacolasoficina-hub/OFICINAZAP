import { route, HttpError } from "@/lib/api";
import { getEtapas, setEtapas, type Etapa } from "@/lib/crm";

// Etapas do CRM: todos leem; só o administrador cria, renomeia, apaga ou reordena.
export const GET = route(async () => ({ etapas: await getEtapas() }));

export const PUT = route(async (req) => {
  const b = (await req.json()) as { etapas?: Etapa[] };
  if (!Array.isArray(b.etapas)) throw new HttpError(400, "envie a lista de etapas");
  return { etapas: await setEtapas(b.etapas) };
});
