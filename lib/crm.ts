import { getSetting, setSetting } from "./db";
import { STAGES } from "./stages";

// Etapas do CRM (funil) definidas pelo administrador. Guardadas em settings "crm_etapas".
export type Etapa = { key: string; label: string; color: string; fim?: boolean; bling?: boolean };

const CORES: Record<string, string> = { novo: "#6b7280", orcamento: "#2b6cb0", arte: "#6b46c1", fechado: "#128c4a", producao: "#2c7a7b", entregue: "#38a169", perdido: "#c53030" };
const PADRAO: Etapa[] = STAGES.map((s) => ({ key: s.key, label: s.label, color: CORES[s.key], fim: s.key === "entregue" || s.key === "perdido", bling: s.key === "fechado" }));

let cache: { t: number; v: Etapa[] } | null = null;

export async function getEtapas(): Promise<Etapa[]> {
  if (cache && Date.now() - cache.t < 15_000) return cache.v;
  const v = await getSetting<Etapa[]>("crm_etapas", PADRAO);
  cache = { t: Date.now(), v: Array.isArray(v) ? v : PADRAO };
  return cache.v;
}

export async function setEtapas(lista: Etapa[]) {
  const limpa: Etapa[] = [];
  const vistos = new Set<string>();
  for (const e of lista) {
    const label = String(e.label ?? "").trim().slice(0, 40);
    if (!label) continue;
    let key = String(e.key ?? "").trim().slice(0, 40) || label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "etapa";
    while (vistos.has(key)) key += "_";
    vistos.add(key);
    limpa.push({ key, label, color: /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : "#6b7280", fim: !!e.fim, bling: !!e.bling });
  }
  await setSetting("crm_etapas", limpa);
  cache = { t: Date.now(), v: limpa };
  return limpa;
}

export async function etapaValida(key: unknown) {
  return typeof key === "string" && (await getEtapas()).some((e) => e.key === key);
}

export async function etapasAbertas() {
  return (await getEtapas()).filter((e) => !e.fim).map((e) => e.key);
}
