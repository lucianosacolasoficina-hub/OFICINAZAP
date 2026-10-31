// Instruções públicas de exclusão de dados (exigidas pela Meta para o app do Instagram).
export const metadata = { title: "Exclusão de dados — OficinaZap" };

export default function Exclusao() {
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 20px", lineHeight: 1.6, fontFamily: "system-ui, sans-serif" }}>
      <h1>Como pedir a exclusão dos seus dados</h1>
      <p>Para apagar as conversas e os dados que a Sacolas Oficina guardou a partir das suas mensagens no Instagram ou no WhatsApp:</p>
      <ol>
        <li>Envie uma mensagem com o texto &quot;Exclusão de dados&quot; pelo Direct do Instagram ou pelo WhatsApp da Sacolas Oficina.</li>
        <li>Se escrever por outro canal, informe o seu nome de usuário do Instagram ou o seu telefone.</li>
      </ol>
      <p>Confirmamos o pedido e concluímos a exclusão em até 30 dias.</p>
    </main>
  );
}
