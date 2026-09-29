const ACTIVE_STATUSES = new Set(["new", "in_preparation", "ready"]);

export function groupWaiterOrders(orders) {
  const active = orders.filter((order) => ACTIVE_STATUSES.has(order.status));
  const byOldest = (a, b) => new Date(a.created_at) - new Date(b.created_at);
  return {
    inProgress: active.filter((order) => order.status !== "ready").sort(byOldest),
    ready: active.filter((order) => order.status === "ready").sort(byOldest),
  };
}

export function waiterElapsedMinutes(order, now = Date.now()) {
  const source = order.status === "new" ? order.created_at : order.updated_at;
  const timestamp = new Date(source || order.created_at).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((now - timestamp) / 60000));
}
