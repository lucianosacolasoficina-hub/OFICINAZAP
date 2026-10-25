# OficinaZap

Sistema de atendimento no WhatsApp com IA para a Sacolas Oficina.

## O que já faz

- **Caixa de entrada com vários atendentes:** todas as conversas do WhatsApp num só lugar, com filtros (Aguardando, Em atendimento, IA, Encerradas), contador de não lidas e atualização automática a cada 3 segundos.
- **IA atendendo 24h:** responde dúvidas usando só as informações da empresa cadastradas em Configurações, coleta os dados do orçamento (produto, quantidade, tamanho, material, cores, arte, prazo, CEP) e passa para um humano quando precisa.
- **Assumir, devolver para a IA ou encerrar** cada conversa. Quando um atendente responde, a IA para de responder naquela conversa.
- **Respostas rápidas:** digite `/` no chat para inserir textos prontos.
- **Contatos com etiquetas** e tela de **orçamentos coletados**.
- **Funil de vendas (CRM em colunas):** Novo lead, Orçamento enviado, Arte em aprovação, Pedido fechado, Em produção, Entregue e Perdido. Quem pede orçamento entra sozinho em "Novo lead"; é só arrastar os cards e anotar o valor.
- **Painel** com conversas aguardando, atendimentos do dia, quanto a IA resolve sozinha e o valor vendido no mês.
- **IA vê imagens:** quando o cliente manda a logo ou uma foto de referência, a IA entende e usa no orçamento. As imagens também aparecem no chat.
- **Integração com o Bling:** conecte em Configurações > Conectar ao Bling. Quando um card do funil vai para "Pedido fechado", o cliente e um pedido de venda (com produto, quantidade, valor e os dados do orçamento) são criados no Bling. Dá para reenviar pelo card se algo falhar.
- **Duas formas de conectar o WhatsApp**, trocando uma linha no `.env`:
  - `evolution`: não oficial, por QR Code (use um número secundário, há risco de banimento);
  - `meta`: API oficial do WhatsApp.

## Tecnologia

Next.js 15 (TypeScript), Supabase (banco Postgres e login), Claude (IA da Anthropic), Evolution API ou WhatsApp Cloud API.

## Como colocar no ar

### 1. Banco de dados (Supabase)

1. Crie um projeto grátis em https://supabase.com.
2. Abra **SQL Editor**, cole o conteúdo de `supabase/migrations/001_init.sql` e clique em **Run**. Depois faça o mesmo com `supabase/migrations/002_crm.sql`.
3. Em **Authentication > Users**, clique em **Add user** e crie o login de cada atendente (e-mail e senha).
4. Em **Project Settings > API**, copie a URL, a `anon key` e a `service_role key` para o `.env`.

### 2. Chave da IA

Crie uma chave em https://console.anthropic.com e coloque em `ANTHROPIC_API_KEY`.

### 3. Configurar e rodar o sistema

```bash
cp .env.example .env    # preencha os valores
npm install
npm run dev             # abre em http://localhost:3000
```

Para produção, a forma mais simples é a Vercel: importe o repositório, cole as variáveis do `.env` em **Settings > Environment Variables** e publique.

### 4. Conectar o WhatsApp pela Evolution API (QR Code)

A Evolution API precisa ficar ligada 24h num servidor (Railway, Render, uma VPS etc.), pois ela mantém o WhatsApp conectado.

```bash
export EVOLUTION_API_KEY=uma-chave-secreta
docker compose -f docker-compose.evolution.yml up -d
```

Crie a instância e leia o QR Code (troque `SUA_URL_EVOLUTION`, `CHAVE` e `SEU_SISTEMA`):

```bash
# cria a instância "oficina"
curl -X POST SUA_URL_EVOLUTION/instance/create \
  -H "apikey: CHAVE" -H "Content-Type: application/json" \
  -d '{"instanceName":"oficina","integration":"WHATSAPP-BAILEYS","qrcode":true}'

# mostra o QR Code (abra o campo base64 como imagem, ou use o painel /manager da Evolution)
curl SUA_URL_EVOLUTION/instance/connect/oficina -H "apikey: CHAVE"

# avisa o sistema a cada mensagem recebida
curl -X POST SUA_URL_EVOLUTION/webhook/set/oficina \
  -H "apikey: CHAVE" -H "Content-Type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"https://SEU_SISTEMA/api/webhooks/whatsapp?token=SEU_WEBHOOK_SECRET","events":["MESSAGES_UPSERT"]}}'
```

No celular: WhatsApp > Aparelhos conectados > Conectar aparelho > leia o QR Code.

### 5. Migrar para a API oficial da Meta (depois)

1. Crie um app em https://developers.facebook.com com o produto **WhatsApp** e verifique a empresa no Meta Business.
2. Preencha `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_APP_SECRET` e invente um `META_VERIFY_TOKEN`.
3. No app da Meta, configure o webhook para `https://SEU_SISTEMA/api/webhooks/whatsapp` com o mesmo verify token e assine o campo `messages`.
4. Troque `WHATSAPP_PROVIDER=meta`. Nada mais muda no sistema.

## Primeiros passos depois de instalar

1. Entre com o login criado no Supabase.
2. Em **Configurações**, preencha as informações da empresa (produtos, tamanhos, pedido mínimo, prazos, pagamento, frete). É daí que a IA tira as respostas.
3. Cadastre suas respostas rápidas (ex.: `/pix`, `/prazo`).
4. Mande uma mensagem de teste para o número conectado.

### Conectar o Bling

1. No Supabase, rode `supabase/migrations/003_bling.sql` no **SQL Editor**.
2. No Bling, abra **Central de Extensões > Área do Integrador > Criar aplicativo** (tipo "Aplicativo próprio"/privado). Em **Link de redirecionamento**, coloque `https://SEU-SISTEMA/api/bling/callback`. Marque os escopos de **Contatos** e **Pedidos de Venda**.
3. Copie o **Client Id** e o **Client Secret** do app para `BLING_CLIENT_ID` e `BLING_CLIENT_SECRET` (no Render: serviço oficinazap > Environment).
4. No OficinaZap, vá em **Configurações > Conectar ao Bling** e autorize com seu login do Bling.

## Próximas fases

- Transcrição de áudios, follow-up automático para orçamentos sem resposta.
- Campanhas, Instagram, agendamento de mensagens e relatórios.
