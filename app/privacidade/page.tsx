// Política de privacidade pública (exigida pela Meta para o app do Instagram).
export const metadata = { title: "Política de privacidade — OficinaZap" };

export default function Privacidade() {
  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: "0 20px", lineHeight: 1.6, fontFamily: "system-ui, sans-serif" }}>
      <h1>Política de privacidade — OficinaZap (Sacolas Oficina)</h1>
      <p>O OficinaZap é o sistema de atendimento da Sacolas Oficina. Ele recebe e responde as mensagens que clientes enviam para os nossos canais oficiais (WhatsApp e Instagram Direct).</p>
      <h2>Quais dados usamos</h2>
      <p>Nome e nome de usuário públicos do perfil, o identificador da conversa fornecido pela plataforma, o conteúdo das mensagens e arquivos enviados à Sacolas Oficina.</p>
      <h2>Para que usamos</h2>
      <p>Somente para atender o cliente: responder dúvidas, fazer orçamentos e acompanhar pedidos. Não vendemos nem compartilhamos esses dados com terceiros para publicidade.</p>
      <h2>Onde ficam</h2>
      <p>Em servidores com acesso restrito à equipe de atendimento da Sacolas Oficina, protegidos por login.</p>
      <h2>Seus direitos</h2>
      <p>Você pode pedir a qualquer momento a cópia ou a exclusão dos seus dados. Veja como em <a href="/exclusao-de-dados">exclusão de dados</a>.</p>
      <p>Contato: pelos canais de atendimento da Sacolas Oficina (WhatsApp ou Direct do Instagram).</p>
    </main>
  );
}
