# WhatsApp via provider Baileys

O domínio do DACOT permanece no FastAPI: conversas, clientes, mensagens,
pedidos, consentimento, RBAC e isolamento por restaurante. O transporte é um
provider separado em `whatsapp-gateway/`, baseado em Baileys.

## Variáveis do backend

- `WHATSAPP_PROVIDER_URL`: URL interna do gateway, por exemplo
  `http://whatsapp-gateway:3100`.
- `WHATSAPP_PROVIDER_SECRET`: segredo aleatório de pelo menos 32 caracteres,
  compartilhado somente entre API e gateway.

## Variáveis do gateway

- `MONGO_URL` e `DB_NAME`: o mesmo MongoDB do backend.
- `WHATSAPP_PROVIDER_SECRET`: o mesmo segredo interno do backend.
- `WHATSAPP_SESSION_ENCRYPTION_KEY`: chave aleatória de 32 bytes em Base64.
- `DACOT_BACKEND_INTERNAL_URL`: URL interna do backend, sem `/api` no final.
- `PORT`: porta HTTP interna, padrão `3100`.

As credenciais e chaves Signal são criptografadas com AES-256-GCM no MongoDB.
Não são usados diretórios de sessão por restaurante e nenhum segredo é
devolvido ao frontend. O QR é efêmero e só pode ser consultado por usuários
`admin` ou `manager` do restaurante autenticado.

Execute o gateway com Node.js 20.19 ou superior:

```text
cd whatsapp-gateway
npm ci
npm start
```

O gateway deve ficar acessível somente pela rede interna da aplicação. A API
e o gateway autenticam todas as chamadas nos dois sentidos com HMAC-SHA256.
