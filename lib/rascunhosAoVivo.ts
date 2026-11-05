// Entrega "ao vivo" dos rascunhos do sistema de gestão para o OficinaZap que já está aberto.
// O OficinaZap aberto fica numa espera longa (GET /api/rascunhos/fila); quando o sistema deixa
// um rascunho para o mesmo atendente (mesmo e-mail), ele chega na hora e abre na própria aba,
// sem abrir outra janela. Guardado na memória do servidor (uma instância só).
type Item = { id: string; tel: string; nome: string; em: number };
type Est = { visto: Map<string, number>; fila: Map<string, Item[]>; esperando: Map<string, Set<(l: Item[]) => void>> };
const g = globalThis as unknown as { __rascAoVivo?: Est };
const E: Est = g.__rascAoVivo ?? (g.__rascAoVivo = { visto: new Map(), fila: new Map(), esperando: new Map() });

export function marcarPresenca(email: string) {
  E.visto.set(email, Date.now());
}

/** O OficinaZap deste atendente está aberto agora (esperando ou visto há menos de 45 s)? */
export function estaAberto(email: string) {
  if ((E.esperando.get(email)?.size ?? 0) > 0) return true;
  const t = E.visto.get(email);
  return !!t && Date.now() - t < 45_000;
}

export function entregar(email: string, it: Item) {
  const ws = E.esperando.get(email);
  if (ws && ws.size) {
    const l = [it];
    ws.forEach((f) => f(l));
    ws.clear();
    return;
  }
  const f = (E.fila.get(email) ?? []).concat([it]).slice(-10);
  E.fila.set(email, f);
}

export function esperar(email: string, ms: number): Promise<Item[]> {
  marcarPresenca(email);
  const f = (E.fila.get(email) ?? []).filter((x) => Date.now() - x.em < 120_000);
  E.fila.delete(email);
  if (f.length || ms <= 0) return Promise.resolve(f);
  return new Promise((res) => {
    const set = E.esperando.get(email) ?? new Set();
    E.esperando.set(email, set);
    const cb = (l: Item[]) => {
      clearTimeout(t);
      marcarPresenca(email);
      res(l);
    };
    set.add(cb);
    const t = setTimeout(() => {
      set.delete(cb);
      marcarPresenca(email);
      res([]);
    }, ms);
  });
}
