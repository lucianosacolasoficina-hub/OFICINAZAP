// Roda uma vez quando o servidor sobe. O import fica dentro do if para não entrar no pacote "edge".
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
