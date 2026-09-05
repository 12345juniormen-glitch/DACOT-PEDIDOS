// Linha do tempo do pedido — só usa timestamps que os dados atuais permitem afirmar com
// certeza: created_at (fixo), o timestamp do status ATUAL (updated_at/delivered_at/
// cancelled_at, conforme o caso) e nada mais. updated_at é sobrescrito a cada transição de
// status real (backend/modules/orders/routes.py, inclusive rollback), então nunca
// representa uma etapa anterior já ultrapassada — por isso nunca reconstruímos etapas
// intermediárias que já perderam seu horário confiável. Sem dependências: usada por
// OrderDetailPage.jsx e testável isoladamente (orderTimeline.test.js).

export const CURRENT_STATUS_TIMELINE = {
  new: { label: "Novo", field: "created_at" },
  in_preparation: { label: "Em preparo", field: "updated_at" },
  ready: { label: "Pronto", field: "updated_at" },
  delivered: { label: "Entregue", field: "delivered_at" },
  cancelled: { label: "Cancelado", field: "cancelled_at" },
};

export function formatDurationMinutes(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}min`;
}

/**
 * Sempre inclui "Pedido criado". Só adiciona um segundo evento (o status atual) quando
 * temos um horário diferente da criação — evita duplicar a mesma hora para um pedido
 * ainda "new", e nunca inventa um horário para uma etapa que já foi ultrapassada.
 */
export function buildTimelineEvents(order) {
  const events = [{ label: "Pedido criado", at: order.created_at, status: null }];
  const stage = CURRENT_STATUS_TIMELINE[order.status];
  const stageAt = stage ? order[stage.field] : null;
  if (stageAt && stageAt !== order.created_at) {
    events.push({ label: stage.label, at: stageAt, status: order.status });
  }
  return events;
}

/** created_at -> fim (delivered_at/cancelled_at) ou -> agora se ainda ativo. null se um
 * pedido finalizado antigo não tiver o timestamp de encerramento (dado incompleto). */
export function computeTotalDurationMs(order, now = Date.now()) {
  if (order.status === "delivered") {
    return order.delivered_at ? new Date(order.delivered_at).getTime() - new Date(order.created_at).getTime() : null;
  }
  if (order.status === "cancelled") {
    return order.cancelled_at ? new Date(order.cancelled_at).getTime() - new Date(order.created_at).getTime() : null;
  }
  if (order.status === "new" || order.status === "in_preparation" || order.status === "ready") {
    return now - new Date(order.created_at).getTime();
  }
  return null;
}

/** Só para in_preparation/ready: updated_at nesse caso é exatamente quando o pedido
 * entrou no status em que está agora — uma duração precisa, não uma estimativa. */
export function computeUntilCurrentDurationMs(order) {
  if ((order.status === "in_preparation" || order.status === "ready") && order.updated_at) {
    const ms = new Date(order.updated_at).getTime() - new Date(order.created_at).getTime();
    return ms >= 0 ? ms : null;
  }
  return null;
}
