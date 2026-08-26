export const brl = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

export const formatDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

export const STATUS_LABEL = {
  new: "Novo",
  in_preparation: "Em preparo",
  ready: "Pronto",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export const STATUS_CLASS = {
  new: "status-new",
  in_preparation: "status-in_prep",
  ready: "status-ready",
  delivered: "status-delivered",
  cancelled: "status-cancelled",
};

export const STATUS_ORDER = ["new", "in_preparation", "ready", "delivered", "cancelled"];

export const NEXT_STATUS = {
  new: "in_preparation",
  in_preparation: "ready",
  ready: "delivered",
};
