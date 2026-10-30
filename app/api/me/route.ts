import { route } from "@/lib/api";
import { allPerms, getAgent } from "@/lib/perms";

/** Quem está logado e o que pode fazer (usado para esconder menus e botões). */
export const GET = route(async (_req, _ctx, userId) => {
  const agent = await getAgent(userId);
  return { id: userId, name: agent?.name ?? "", role: agent?.role ?? "agent", perms: allPerms(agent) };
});
