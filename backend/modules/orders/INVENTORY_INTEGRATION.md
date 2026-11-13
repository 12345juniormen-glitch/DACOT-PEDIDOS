# Integração opcional com DACOT-ESTOQUE

O Pedidos emite o snapshot versionado do pedido ao entrar em `in_preparation`, e em cada edição/status seguinte. Criar um pedido em `new` não consome estoque. Os snapshots contêm IDs estáveis de produto e quantidades; nomes servem apenas para exibição. Notas, dados de clientes, receitas e cálculos de ingredientes não saem do Pedidos.

Cada evento fica em uma fila FIFO (`inventory_outbox`) no próprio documento do pedido, na mesma gravação atômica da alteração comercial. O worker só envia o primeiro evento pendente de cada pedido; assim, transições como `in_preparation` e cancelamento não se sobrepõem nem desaparecem durante uma falha. Após resposta 2xx do Estoque, o evento sai da fila. Falhas de transporte usam backoff exponencial limitado e permanecem salvas após reinício. A indisponibilidade do Estoque não bloqueia o atendimento.

O envio é `POST` HTTPS com HMAC-SHA256 sobre método, caminho, timestamp e corpo. O Estoque aceita janela temporal de cinco minutos, valida o ID/evento/revisão e aplica uma chave idempotente. A chave deve ser exclusiva da integração e permanecer apenas nos backends.

Por padrão, nada é enviado. Para homologação, configurar no servidor:

- `INVENTORY_INTEGRATION_ENABLED=false` (ativar somente após configuração e teste do restaurante escolhido).
- `INVENTORY_INTEGRATION_RESTAURANT_IDS=<restaurant_id>` (allowlist dos restaurantes piloto; não deixe vazia ao ativar).
- `INVENTORY_API_URL=https://<host-do-backend-estoque>`.
- `INVENTORY_INTEGRATION_SECRET=<segredo aleatório com ao menos 32 caracteres>`.

O mesmo segredo deve ser cadastrado como `ORDERS_INTEGRATION_SECRET` no backend Estoque. As variáveis não são necessárias para Pedidos sem integração. Esta mudança não toca autenticação/HUB, frontend de atendimento ou estado dos pedidos visível ao operador.

Eventos completos e fora de ordem são reconciliados por `order_revision`. A API do Estoque é a autoridade para ativação por restaurante, fichas e saldo.
