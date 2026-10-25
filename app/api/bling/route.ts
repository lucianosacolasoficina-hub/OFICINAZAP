import { route } from "@/lib/api";
import { blingConfigured, blingConnected, disconnectBling } from "@/lib/bling";

export const GET = route(async () => ({ configured: blingConfigured(), connected: await blingConnected() }));

export const DELETE = route(async () => {
  await disconnectBling();
});
