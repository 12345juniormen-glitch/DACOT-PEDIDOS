import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { api, formatApiError } from "@/lib/api";
import { brl, formatTime } from "@/lib/format";
import { formatDurationMinutes } from "@/lib/orderTimeline";
import { toast } from "sonner";

// Detalhamento operacional dos cards de "Vendas & desempenho hoje" do Dashboard. Cada
// `kind` reaproveita GET /orders (existente) com os mesmos filtros today_only/
// delivered_today_only que já alimentam GET /orders/stats — a lista aqui sempre soma/conta
// exatamente o mesmo que o card que abriu o dialog, porque é literalmente a mesma consulta.
const KIND_CONFIG = {
  revenue: {
    title: "Faturamento de hoje",
    description: "Pedidos criados hoje que já foram entregues — é isso que compõe o valor do faturamento.",
    params: { status: "delivered", today_only: true, limit: 500 },
  },
  createdToday: {
    title: "Pedidos de hoje",
    description: "Todos os pedidos criados hoje, em qualquer status.",
    params: { today_only: true, limit: 500 },
  },
  deliveredToday: {
    title: "Entregues hoje",
    description: "Pedidos entregues hoje.",
    params: { delivered_today_only: true, limit: 500 },
  },
  avgTime: {
    title: "Tempo total médio hoje",
    description: "Tempo do pedido do início ao fim (criação até entrega). Não é tempo de preparo — o sistema não registra quando cada pedido entrou em cada etapa intermediária.",
    params: { delivered_today_only: true, limit: 500 },
  },
};

function durationMs(order) {
  return new Date(order.delivered_at).getTime() - new Date(order.created_at).getTime();
}

function computeDurationStats(orders) {
  if (orders.length === 0) return null;
  const durations = orders.map(durationMs);
  const sumMs = durations.reduce((a, b) => a + b, 0);
  return {
    count: orders.length,
    avgMs: sumMs / orders.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    sumMs,
  };
}

function SummaryStat({ label, value }) {
  return (
    <div className="bg-muted/50 rounded-md p-2.5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className="mt-0.5 font-display font-bold text-foreground">{value}</div>
    </div>
  );
}

function MetricRowBody({ kind, order }) {
  if (kind === "revenue") {
    return (
      <>
        <div className="text-xs text-muted-foreground mb-1">{formatTime(order.delivered_at)}</div>
        <div className="text-sm text-foreground truncate mb-1">
          {order.items.map((i) => `${i.quantity}x ${i.product_name}`).join(", ")}
        </div>
        <div className="text-sm font-semibold text-foreground">{brl(order.total)}</div>
      </>
    );
  }
  if (kind === "createdToday") {
    return (
      <>
        <div className="text-xs text-muted-foreground mb-1">{formatTime(order.created_at)}</div>
        <div className="text-sm text-foreground truncate mb-1">
          {order.customer_name || <span className="italic text-muted-foreground">Sem cliente</span>}
        </div>
        <div className="text-sm font-semibold text-foreground">{brl(order.total)}</div>
      </>
    );
  }
  if (kind === "deliveredToday") {
    return (
      <>
        <div className="text-xs text-muted-foreground mb-1">{formatTime(order.delivered_at)}</div>
        <div className="text-sm text-foreground truncate mb-1">
          {order.customer_name || <span className="italic text-muted-foreground">Sem cliente</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">{brl(order.total)}</span>
          <span className="text-xs text-muted-foreground">{formatDurationMinutes(durationMs(order))}</span>
        </div>
      </>
    );
  }
  // avgTime
  return (
    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
      <span>Criado {formatTime(order.created_at)}</span>
      <span>Entregue {formatTime(order.delivered_at)}</span>
      <span className="font-semibold text-foreground">{formatDurationMinutes(durationMs(order))}</span>
    </div>
  );
}

export function DashboardMetricDialog({ open, onOpenChange, kind }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const config = kind ? KIND_CONFIG[kind] : null;

  useEffect(() => {
    if (!open || !config) return;
    let cancelled = false;
    setOrders([]);
    setError(false);
    setLoading(true);
    api
      .get("/orders", { params: config.params })
      .then(({ data }) => {
        if (!cancelled) setOrders(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(true);
          toast.error(formatApiError(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, config]);

  const durationStats = kind === "avgTime" && !loading && !error ? computeDurationStats(orders) : null;
  const monetaryTotal = orders.length > 0 ? orders.reduce((sum, o) => sum + o.total, 0) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dashboard-metric-dialog">
        {config && (
          <>
            <DialogHeader>
              <DialogTitle data-testid="dashboard-metric-title">{config.title}</DialogTitle>
              <DialogDescription>{config.description}</DialogDescription>
            </DialogHeader>

            {loading && <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>}

            {!loading && error && (
              <EmptyState icon={ClipboardList} title="Não foi possível carregar os pedidos." compact />
            )}

            {!loading && !error && orders.length === 0 && (
              <EmptyState icon={ClipboardList} title="Nenhum pedido encontrado." compact />
            )}

            {durationStats && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4" data-testid="avg-time-summary">
                <SummaryStat label="Considerados" value={durationStats.count} />
                <SummaryStat label="Média" value={formatDurationMinutes(durationStats.avgMs)} />
                <SummaryStat label="Menor" value={formatDurationMinutes(durationStats.minMs)} />
                <SummaryStat label="Maior" value={formatDurationMinutes(durationStats.maxMs)} />
                <SummaryStat label="Soma total" value={formatDurationMinutes(durationStats.sumMs)} />
              </div>
            )}

            {!loading && !error && orders.length > 0 && (
              <div className="space-y-2" data-testid="dashboard-metric-list">
                {orders.map((o) => (
                  <Link
                    key={o.id}
                    to={`/pedidos/${o.id}`}
                    onClick={() => onOpenChange(false)}
                    className="block border rounded-md p-3 hover:border-primary/40 hover:bg-accent/30 transition-colors"
                    data-testid={`dashboard-metric-order-${o.order_number}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-display font-semibold text-foreground">#{o.order_number}</span>
                      {kind !== "avgTime" && <StatusBadge status={o.status} />}
                    </div>
                    <MetricRowBody kind={kind} order={o} />
                  </Link>
                ))}
              </div>
            )}

            {!loading && !error && orders.length > 0 && kind !== "avgTime" && (
              <div className="mt-4 pt-3 border-t flex items-center justify-between text-sm" data-testid="dashboard-metric-total">
                <span className="text-muted-foreground">{orders.length} pedido{orders.length !== 1 ? "s" : ""}</span>
                <span className="font-semibold text-foreground">Total: {brl(monetaryTotal)}</span>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
