import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardMetricDialog } from "@/components/DashboardMetricDialog";
import { api, formatApiError } from "@/lib/api";
import { brl, formatTime, NEXT_STATUS, STATUS_LABEL } from "@/lib/format";
import { formatDurationMinutes } from "@/lib/orderTimeline";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { hasPermission } from "@/lib/permissions";
import { toast } from "sonner";

const COLUMNS = [
  { key: "new", label: "Novo", accent: "bg-[#5c9beb]", dot: "bg-[#367fda] dark:bg-[#5c9beb]" },
  { key: "in_preparation", label: "Em preparo", accent: "bg-[#b97822] dark:bg-[#e6a04a]", dot: "bg-[#b97822] dark:bg-[#e6a04a]" },
  { key: "ready", label: "Pronto", accent: "bg-[#2e8f63] dark:bg-[#4fbe8b]", dot: "bg-[#2e8f63] dark:bg-[#4fbe8b]" },
];

const ATTENTION_THRESHOLD_MS = 20 * 60 * 1000;

export default function DashboardPage() {
  useDocumentTitle("Dashboard");
  const { user } = useAuth();
  const canSeeFinance = hasPermission(user, "dashboard.metrics");
  const canCreateOrder = hasPermission(user, "orders.create");
  const canViewOrders = hasPermission(user, "orders.view");
  const canOrderStatus = hasPermission(user, "orders.status");
  const canKdsStatus = hasPermission(user, "kds.status");
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [metricDialog, setMetricDialog] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const ordersRes = await api.get("/orders", { params: { active_only: true } });
      setOrders(ordersRes.data);
      if (canSeeFinance) {
        const statsRes = await api.get("/orders/stats");
        setStats(statsRes.data);
      }
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preserva o polling atual de 30s
  }, []);

  const byStatus = useMemo(() => {
    const grouped = { new: [], in_preparation: [], ready: [] };
    for (const order of orders) if (grouped[order.status]) grouped[order.status].push(order);
    return grouped;
  }, [orders]);

  const attentionCount = useMemo(
    () => byStatus.in_preparation.filter(
      (order) => Date.now() - new Date(order.updated_at).getTime() >= ATTENTION_THRESHOLD_MS,
    ).length,
    [byStatus],
  );

  const advance = async (order) => {
    const next = NEXT_STATUS[order.status];
    if (!next || (!canOrderStatus && (!canKdsStatus || next === "delivered"))) return;
    try {
      await api.patch(`/orders/${order.id}/status`, { status: next });
      toast.success(`Pedido #${order.order_number} → ${STATUS_LABEL[next]}`);
      load();
    } catch (error) {
      toast.error(formatApiError(error));
    }
  };

  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const operationalState = byStatus.ready.length > 0
    ? `${byStatus.ready.length} aguardando entrega`
    : orders.length > 0
      ? `${orders.length} pedido${orders.length === 1 ? "" : "s"} ativo${orders.length === 1 ? "" : "s"}`
      : "nenhuma ação pendente";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-[1340px] flex-col px-4 py-5 sm:px-7 md:min-h-screen lg:px-[54px] lg:py-8">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between lg:pb-7">
        <div>
          <h1 className="text-[26px] font-bold leading-tight text-foreground">Operação</h1>
          <p className="mt-0.5 text-xs text-muted-foreground first-letter:uppercase">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={loading} data-testid="refresh-orders-button" size="sm" className="h-[34px] rounded-[5px] px-4 text-[11px] shadow-none">
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          {canCreateOrder && (
            <Button asChild data-testid="create-order-button" size="sm" className="h-[34px] rounded-[5px] px-4 text-[11px] shadow-none">
              <Link to="/pedidos/novo"><Plus className="mr-1.5 h-3.5 w-3.5" /> Novo pedido</Link>
            </Button>
          )}
        </div>
      </header>

      <section className="grid gap-5 border-b py-4 sm:grid-cols-2 lg:grid-cols-[180px_220px_220px_1fr] lg:items-center" data-testid="ops-now">
        {COLUMNS.map((column) => (
          <div key={column.key} className="flex items-center gap-4" data-testid={`ops-now-${column.key}`}>
            <span className="text-[32px] font-bold leading-none tabular-nums text-foreground">{byStatus[column.key].length}</span>
            <span className="text-xs font-medium text-muted-foreground">
              {column.label.toLowerCase()}
              <span className={`mt-1.5 block h-1.5 w-1.5 rounded-full ${column.dot}`} aria-hidden="true" />
            </span>
          </div>
        ))}
        <div className="lg:justify-self-end">
          {attentionCount > 0 ? (
            <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="ops-now-attention">
              <AlertTriangle className="h-3.5 w-3.5" />
              {attentionCount} em preparo há mais de 20 min
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{operationalState}</p>
          )}
        </div>
      </section>

      {user?.role === "kitchen" && (
        <Link to="/cozinha" className="mt-4 text-xs font-semibold text-primary underline-offset-4 hover:underline" data-testid="kitchen-shortcut-banner">
          Abrir tela da Cozinha →
        </Link>
      )}

      <section className="flex-1 pt-7">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-[15px] font-semibold text-foreground">Fila de pedidos</h2>
          <span className="text-[11px] text-muted-foreground">ordem operacional</span>
        </div>

        <div className="grid lg:min-h-[390px] lg:grid-cols-3">
          {COLUMNS.map((column, index) => (
            <section
              key={column.key}
              className={`min-w-0 pb-7 lg:px-4 ${index === 0 ? "lg:pl-0" : "lg:border-l"} ${index === COLUMNS.length - 1 ? "lg:pr-0" : ""}`}
              data-testid={`column-${column.key}`}
            >
              <div className="flex items-center gap-2 border-b pb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={`h-[7px] w-[7px] rounded-full ${column.dot}`} aria-hidden="true" />
                {column.label}
                <span className="ml-auto tabular-nums">{byStatus[column.key].length}</span>
              </div>
              <div>
                {byStatus[column.key].map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    accent={column.accent}
                    canOpen={canViewOrders}
                    canAdvance={!!NEXT_STATUS[order.status] && (canOrderStatus || (canKdsStatus && NEXT_STATUS[order.status] !== "delivered"))}
                    onAdvance={() => advance(order)}
                  />
                ))}
                {!loading && byStatus[column.key].length === 0 && (
                  <p className="py-8 text-center text-xs text-muted-foreground">Sem pedidos</p>
                )}
              </div>
            </section>
          ))}
        </div>
        {!loading && orders.length === 0 && (
          <p className="-mt-5 text-center text-xs text-muted-foreground">Os pedidos aparecem aqui conforme entram.</p>
        )}
      </section>

      {canSeeFinance && (
        <section className="border-t pb-3 pt-5">
          <h2 className="mb-4 text-xs font-semibold text-muted-foreground">Hoje</h2>
          <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-4 lg:grid-cols-[1.2fr_0.8fr_0.9fr_1fr]">
            <MetricButton label="Faturamento" value={stats ? brl(stats.today_revenue) : "—"} testid="metric-revenue" onClick={() => setMetricDialog("revenue")} />
            <MetricButton label="Pedidos" value={stats ? stats.orders_created_today : "—"} testid="metric-orders-today" onClick={() => setMetricDialog("createdToday")} />
            <MetricButton label="Entregues" value={stats ? stats.orders_delivered_today : "—"} testid="metric-delivered-today" onClick={() => setMetricDialog("deliveredToday")} />
            <MetricButton
              label="Tempo total médio"
              value={stats && stats.avg_order_total_minutes_today != null ? formatDurationMinutes(stats.avg_order_total_minutes_today * 60000) : "—"}
              testid="metric-avg-total-time-today"
              onClick={() => setMetricDialog("avgTime")}
            />
          </div>
        </section>
      )}

      <DashboardMetricDialog open={!!metricDialog} onOpenChange={(open) => !open && setMetricDialog(null)} kind={metricDialog} />
    </div>
  );
}

function OrderRow({ order, accent, canOpen, canAdvance, onAdvance }) {
  const itemSummary = order.items
    .map((item) => `${item.quantity} × ${item.product_name || item.name || "Item"}`)
    .join(" · ");
  const actionLabel = order.status === "new"
    ? "Iniciar"
    : order.status === "in_preparation"
      ? "Marcar pronto"
      : "Entregar";
  const statusTime = order.status === "new" ? order.created_at : order.updated_at;

  return (
    <article className="relative border-b py-4 pl-3 pr-1" data-testid={`order-card-${order.order_number}`}>
      <span className={`absolute bottom-4 left-0 top-4 w-0.5 ${accent}`} aria-hidden="true" />
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-4">
          {canOpen ? (
            <Link to={`/pedidos/${order.id}`} className="shrink-0 text-[13px] font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline">
              #{order.order_number}
            </Link>
          ) : (
            <span className="shrink-0 text-[13px] font-semibold text-foreground">#{order.order_number}</span>
          )}
          <span className="truncate text-[11px] text-muted-foreground">{formatTime(statusTime)}</span>
        </div>
        {canAdvance && (
          <button type="button" onClick={onAdvance} className="shrink-0 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`advance-${order.order_number}`}>
            {actionLabel}
          </button>
        )}
      </div>
      <div className="mt-1 text-xs font-medium text-foreground">{order.customer_name || "Sem cliente"}</div>
      <div className="mt-1 flex min-w-0 items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="truncate">{itemSummary || `${order.items.length} ite${order.items.length === 1 ? "m" : "ns"}`}</span>
        {order.notes && <span className="max-w-[38%] truncate font-medium text-foreground/70">{order.notes}</span>}
      </div>
    </article>
  );
}

function MetricButton({ label, value, testid, onClick }) {
  return (
    <button type="button" onClick={onClick} className="group min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={testid}>
      <div className="text-[23px] font-bold leading-tight text-foreground">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground underline-offset-4 group-hover:text-foreground group-hover:underline">{label} · ver detalhes</div>
    </button>
  );
}
