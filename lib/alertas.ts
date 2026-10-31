import { getSetting } from "./db";

// Limites do alerta de cliente esperando e da lista "Retomar" (orçamentos sem resposta).
// O administrador muda em Configurações.
export type Alertas = {
  /** Minutos esperando resposta até a conversa ficar vermelha e entrar no alerta. */
  espera_min: number;
  /** Dias sem resposta do cliente, depois da nossa última mensagem, para entrar em "Retomar". */
  retomar_dias: number;
};

export const ALERTAS_PADRAO: Alertas = { espera_min: 30, retomar_dias: 2 };

const limita = (n: unknown, min: number, max: number, padrao: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;
};

export function normalizaAlertas(v: Partial<Alertas> | null | undefined): Alertas {
  return {
    espera_min: limita(v?.espera_min, 1, 24 * 60, ALERTAS_PADRAO.espera_min),
    retomar_dias: limita(v?.retomar_dias, 1, 29, ALERTAS_PADRAO.retomar_dias),
  };
}

// Lido a cada atualização da lista: guarda por 30 segundos para não consultar o banco toda hora.
let cache: { t: number; v: Alertas } | null = null;
export async function getAlertas(): Promise<Alertas> {
  if (cache && Date.now() - cache.t < 30_000) return cache.v;
  const v = normalizaAlertas(await getSetting<Partial<Alertas> | null>("alertas", null));
  cache = { t: Date.now(), v };
  return v;
}
export function limpaCacheAlertas() {
  cache = null;
}
