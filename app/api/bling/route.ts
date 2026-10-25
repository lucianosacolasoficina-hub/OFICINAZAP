import { route } from "@/lib/api";
import { blingConfigured, blingConnected, blingEnvStatus, disconnectBling } from "@/lib/bling";

export const GET = route(async () => ({
  configured: blingConfigured(),
  connected: await blingConnected(),
  env: blingConfigured() ? undefined : blingEnvStatus(),
}));

export const DELETE = route(async () => {
  await disconnectBling();
});
