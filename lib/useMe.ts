"use client";

import { useEffect, useState } from "react";
import { api } from "./client";
import type { PermKey } from "./perms";

export type Me = { id: string; name: string; role: "admin" | "agent"; perms: Record<PermKey, boolean> };

let cache: Promise<Me> | null = null;

/** Dados do atendente logado (carregados uma vez por página). */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    cache ??= api<Me>("/api/me");
    cache.then(setMe).catch(() => (cache = null));
  }, []);
  return me;
}
