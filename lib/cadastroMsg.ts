// Mensagem pronta para pedir ao cliente os dados do cadastro (mesmo texto do sistema de gestão).
export function msgCadastro(tipo: "PJ" | "PF") {
  const emp = "Sacolas Oficina";
  if (tipo === "PF")
    return `Olá! Tudo bem? 😊
Para fazermos o seu cadastro aqui na *${emp}*, por favor nos envie os dados abaixo:

👤 *DADOS PESSOAIS*
• Nome completo:
• CPF:
• Data de nascimento:

📍 *ENDEREÇO DE ENTREGA*
• Rua e número:
• Complemento:
• Bairro:
• Cidade/UF:
• CEP:

📞 *CONTATO*
• WhatsApp:
• E-mail (para nota fiscal):
• Instagram (se tiver):

🚚 *ENVIO*
• Transportadora, van ou retirada:

Obrigado! 🙏`;
  return `Olá! Tudo bem? 😊
Para fazermos o seu cadastro aqui na *${emp}*, por favor nos envie os dados abaixo:

🏢 *EMPRESA*
• Nome fantasia:
• Razão social:
• CNPJ:
• Inscrição estadual (ou "isento"):

📍 *ENDEREÇO DE ENTREGA*
• Rua e número:
• Complemento:
• Bairro:
• Cidade/UF:
• CEP:

👤 *CONTATO*
• Responsável (quem fala com a gente):
• WhatsApp:
• Telefone fixo (se tiver):
• E-mail (para nota fiscal e boleto):
• Instagram ou site:

🚚 *ENVIO*
• Transportadora, van ou retirada:

Se preferir, pode mandar uma foto do cartão CNPJ. Obrigado! 🙏`;
}
