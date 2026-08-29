# DACOT — Product Requirements Document

## Original problem statement
Sistema SaaS para restaurantes chamado DACOT, construído em módulos. Primeiro módulo: **Pedidos**, que centraliza os pedidos do restaurante em um único sistema — reduzindo pedidos em papel, perdas, erros entre atendimento e cozinha, dificuldade de acompanhar status e histórico.

## User personas
- **Administrador**: cadastra produtos, clientes, gerencia pedidos.
- **(Futuro) Gerente / Atendimento / Cozinha**: papéis previstos no schema, sem RBAC ainda implementado.

## Core requirements (fixed)
- Multi-tenant real via `restaurant_id` extraído do JWT (`get_tenant` dependency).
- Preço do produto **snapshot** no item do pedido (imune a alterações posteriores).
- Cancelamento **não-destrutivo** (status → `cancelled` + `cancelled_at`).
- Produtos inativos não podem ser vendidos.
- Valores monetários em **centavos (int)** internamente; API expõe reais.
- Transições de status validadas: `new → in_preparation → ready → delivered`, `cancelled` de qualquer estado exceto `delivered`.
- Pedido precisa ter ≥ 1 item.

## Architecture
- **Backend (FastAPI, MongoDB)** — organizado por módulos: `core/` (db, security, deps, money) + `modules/{auth, restaurants, products, customers, orders}`. Cada módulo tem seu router isolado; adicionar `kitchen`, `inventory`, `billing` no futuro = criar nova pasta.
- **Frontend (React + Shadcn UI + Tailwind)** — Sidebar + rotas protegidas. Estado auth em Context. Cálculos client-side apenas para UX; servidor é fonte da verdade.
- **Portabilidade**: sem SDKs proprietários; roda em qualquer host com Mongo + `.env`.

## Data model
- `restaurants { id, name, created_at }`
- `users { id, restaurant_id, email(unique), password_hash, name, role, created_at }`
- `products { id, restaurant_id, name, description, price_cents, category, active, created_at, updated_at }`
- `customers { id, restaurant_id, name, phone, notes, created_at, updated_at }`
- `orders { id, restaurant_id, order_number, customer_id?, customer_name?, items[snapshot], notes, subtotal_cents, discount_type, discount_value, discount_cents, total_cents, status, created_at, updated_at, cancelled_at?, delivered_at?, duplicated_from?, created_by }`

## What's implemented (2026-02)
- ✅ JWT auth (login, /me, logout, change-password) + seed idempotente admin+restaurante
- ✅ **Users CRUD (admin only) + RBAC completo aplicado no backend**
  - Papéis: admin, manager, waiter, kitchen
  - `must_change_password=true` para usuários criados/resetados → backend bloqueia todas as rotas exceto auth/me, auth/logout, auth/change-password
  - Proteção contra remoção/rebaixamento do último admin ativo
  - Kitchen só pode marcar status → ready
- ✅ Products CRUD com soft-delete (admin/manager mutam; waiter GET-only)
- ✅ Customers CRUD (admin/manager/waiter)
- ✅ Orders: criar, ver, editar (com regras de status), duplicar, cancelar, mudar status, listar/filtrar, stats
  - Stats (financeiro) só admin/manager
- ✅ Snapshot de preço e validação de produto ativo na criação
- ✅ Cálculo em cents (Decimal) — sem float bugs
- ✅ Dashboard kanban + métricas + faturamento oculto para waiter/kitchen
- ✅ Histórico com filtros por status e busca
- ✅ Frontend: sidebar filtrada por papel + rotas com RoleGuard + fluxo forçado de troca de senha
- ✅ UI clara/minimalista PT-BR/BRL, Manrope + IBM Plex Sans, accent laranja

## Backlog priorizado

### P1 — Próximos incrementos
- Tela específica de **Cozinha (KDS)**: view por tickets, avançar status com 1 toque
- **Impressão** de pedido (comanda para cozinha, cupom para cliente)
- **Roles & permissões** (RBAC) usando o campo `role` já presente
- Cadastro de **múltiplos usuários** por restaurante (convite por email)
- **Métricas** (relatório diário/semanal): ticket médio, produtos mais vendidos

### P2 — Módulos futuros
- Módulo **Mesas/Comandas**
- Módulo **Delivery** com endereço + status de entrega
- Módulo **Estoque** e ficha técnica
- Módulo **Financeiro**
- Integração **WhatsApp** (envio de comandas para clientes)
- Integração **Pagamentos** (Pix, cartão)

## Tech decisions journal
- `Authorization: Bearer` + localStorage escolhido sobre cookies httpOnly para portabilidade e simplicidade em preview (evita config `SameSite=none/Secure` cross-origin).
- IDs UUID string, não ObjectId — portabilidade e serialização direta.
- Frontend valida cálculos localmente **apenas para UX**; backend recalcula tudo antes de persistir.
