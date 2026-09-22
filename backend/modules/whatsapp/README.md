# WhatsApp Cloud API — configuração da V1

Esta integração usa somente a API oficial da Meta. Não há QR code, sessão Web ou
credencial no frontend. O operador configura no **ambiente seguro do backend**:

- `WHATSAPP_META_APP_SECRET`: segredo do aplicativo Meta, usado para validar o
  HMAC-SHA256 (`X-Hub-Signature-256`) do corpo bruto do webhook.
- `WHATSAPP_VERIFY_TOKEN`: valor aleatório compartilhado com a configuração do
  webhook na Meta.
- `WHATSAPP_GRAPH_VERSION`: versão Graph suportada escolhida na implantação,
  no formato `vN.N`. Não há versão comercial/API presumida no código.
- `WHATSAPP_TENANTS_JSON`: array de objetos com `restaurant_id`,
  `phone_number_id`, `access_token`. Cada número e restaurante devem ser únicos.
  Armazene esse JSON como segredo no provedor de implantação, nunca no Git.

Configure o aplicativo WhatsApp Business da Meta, o número Cloud API e as
permissões de mensagens, publique `https://SEU_BACKEND/api/whatsapp/webhook`
como callback HTTPS, use o mesmo verify token e inscreva a WABA no campo
`messages`. Mapeie o Phone Number ID correto ao `restaurant_id` do DACOT.
Conclua os passos de verificação, registro e aprovação exigidos pela Meta no
ambiente real. Nada disso é executado automaticamente pelo módulo.

A V1 responde com texto apenas até 24 horas da última mensagem recebida do
cliente. Fora da janela, respostas e avisos operacionais de texto são bloqueados
ou registrados como `skipped_outside_window`: **não** são enviados como texto
livre. Para mensagens fora da janela, a empresa precisa atender às exigências
de consentimento e obter modelos aprovados; a V1 não faz esses envios nem
pressupõe aprovação de templates. Falhas de envio são registradas como
`failed` e nunca impedem a operação do pedido. Não há reenvio automático.
Os avisos automáticos dentro da janela também exigem aceite explícito registrado
pelo atendente na conversa; sem ele, ficam como `skipped_no_consent`. O
atendente deve registrar uma autorização real do cliente, não presumir aceite
apenas porque ele enviou uma mensagem.

Os testes usam MongoDB/API e uma simulação da Meta somente em loopback, com
tokens fictícios. Um teste com número real exige credenciais reais configuradas
fora do repositório, número/WABA ativos, callback público HTTPS e assinatura
válida, permissões e aceite das políticas aplicáveis.
