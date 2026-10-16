import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw, ChevronRight, Clock, ChefHat, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { DashboardMetricDialog } from "@/components/DashboardMetricDialog";
import { STATUS_ICON } from "@/components/StatusBadge";
import { api, formatApiError } from "@/lib/api";
import { brl, formatTime, STATUS_LABEL, NEXT_STATUS } from "@/lib/format";
import { formatDurationMinutes } from "@/lib/orderTimeline";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { hasPermission } from "@/lib/permissions";

const COLUMNS = [
  { key: "new", label: "Novo" },
  { key: "in_preparation", label: "Em preparo" },
  { key: "ready", label: "Pronto" },
];

// Mesmo limiar do destaque de atenção do KDS (frontend/src/pages/KitchenPage.jsx):
// 20min+ em preparo. updated_at só muda em transição real de status (backend/modules/
// orders/routes.py), nunca por edição de conteúdo — por isso é seguro usá-lo aqui também.
const ATTENTION_THRESHOLD_MS = 20 * 60 * 1000;
const SHOW_PERFORMANCE_SECTION = false;

export default function DashboardPage() {
  useDocumentTitle("Dashboard");
  const { user } = useAuth();
  const canSeeFinance = hasPermission(user, "dashboard.metrics");
  const canCreateOrder = hasPermission(user, "orders.create");
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
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deve rodar só na montagem; load muda a cada render
  }, []);

  const byStatus = useMemo(() => {
    const g = { new: [], in_preparation: [], ready: [] };
    for (const o of orders) if (g[o.status]) g[o.status].push(o);
    return g;
  }, [orders]);

  const activeTotal = orders.length;

  // Quantos pedidos em preparo já passaram do limiar de atenção — recalculado a cada
  // atualização de `orders` (refresh automático de 30s já existente ou botão Atualizar),
  // sem nenhum timer/polling novo.
  const attentionCount = useMemo(
    () => byStatus.in_preparation.filter((o) => Date.now() - new Date(o.updated_at).getTime() >= ATTENTION_THRESHOLD_MS).length,
    [byStatus],
  );

  const advance = async (o) => {
    const next = NEXT_STATUS[o.status];
    if (!next || (!canOrderStatus && (!canKdsStatus || next === "delivered"))) return;
    try {
      await api.patch(`/orders/${o.id}/status`, { status: next });
      toast.success(`Pedido #${o.order_number} → ${STATUS_LABEL[next]}`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Dashboard"
        subtitle="Pedidos ativos e o que precisa de atenção agora"
        action={
          <>
            <Button variant="outline" onClick={load} disabled={loading} data-testid="refresh-orders-button" size="sm">
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            {canCreateOrder && (
              <Link to="/pedidos/novo">
                <Button data-testid="create-order-button" size="sm">
                  <Plus className="w-4 h-4 mr-1.5" /> Novo Pedido
                </Button>
              </Link>
            )}
          </>
        }
      />

      {user?.role === "kitchen" && (
        <Link
          to="/cozinha"
          className="mb-6 flex items-center justify-between gap-3 rounded-none border border-primary/30 bg-primary/10 px-4 py-3 hover:bg-primary/15 transition-colors"
          data-testid="kitchen-shortcut-banner"
        >
          <span className="flex items-center gap-2.5 text-sm font-medium text-primary">
            <ChefHat className="w-4 h-4" /> Sua tela de trabalho é a Cozinha — pedidos por ticket, botões grandes.
          </span>
          <ArrowRight className="w-4 h-4 text-primary shrink-0" />
        </Link>
      )}

      {/* Indicadores principais — sempre corretos para qualquer papel, calculados a partir dos pedidos ativos já
          carregados (não repetem a contagem por status, que já aparece nas colunas logo abaixo) */}
      <div className="grid grid-cols-2 gap-3 mb-6 max-w-md">
        <Indicator label="Pedidos ativos" value={activeTotal} testid="metric-active" />
        <Indicator label="Prontos p/ entrega" value={byStatus.ready.length} highlight={byStatus.ready.length > 0} testid="metric-ready" />
      </div>

      {attentionCount > 0 && (
        <div
          className="mb-6 flex cursor-default items-center gap-2 rounded-none border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning shadow-none"
          data-testid="ops-now-attention"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">Atenção · </span>
            {attentionCount} pedido{attentionCount !== 1 ? "s" : ""} em preparo há mais de 20 min
          </span>
        </div>
      )}

      {/* Situação atual dos pedidos */}
      <section className="mb-6">
        <SectionTitle>Situação atual dos pedidos</SectionTitle>
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid grid-flow-col auto-cols-[minmax(280px,86vw)] gap-4 lg:grid-flow-row lg:grid-cols-3 lg:auto-cols-auto">
            {COLUMNS.map((col) => {
              const Icon = STATUS_ICON[col.key];
              const statusColor = col.key === "new"
                ? "bg-info"
                : col.key === "in_preparation"
                  ? "bg-warning"
                  : "bg-success";
              return (
                <div
                  key={col.key}
                  className="flex min-h-[190px] flex-col overflow-hidden rounded-none border border-border bg-muted/35"
                  data-testid={`column-${col.key}`}
                >
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${statusColor}`} aria-hidden="true" />
                      {Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                      <h3 className="text-sm font-semibold text-foreground">{col.label}</h3>
                    </div>
                    <span className="tabular-nums text-sm font-semibold text-muted-foreground">
                      {byStatus[col.key].length}
                    </span>
                  </div>

                  <div className="flex max-h-[calc(100vh-390px)] min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
                    {byStatus[col.key].length === 0 && (
                      <p className="px-2 py-5 text-center text-xs text-muted-foreground">Sem pedidos neste status</p>
                    )}
                    {byStatus[col.key].map((o) => (
                      <article
                        key={o.id}
                        className="cursor-default rounded-none border border-border bg-card p-3 shadow-sm"
                        data-testid={`order-card-${o.order_number}`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <Link
                            to={`/pedidos/${o.id}`}
                            className="font-display text-base font-bold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            #{o.order_number}
                          </Link>
                          <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" /> {formatTime(o.created_at)}
                          </span>
                        </div>

                        <div className="mb-2 truncate text-sm font-medium text-foreground">
                          {o.customer_name || <span className="font-normal italic text-muted-foreground">Sem cliente</span>}
                        </div>

                        <ul className="space-y-1 border-t border-border/70 pt-2 text-xs text-muted-foreground">
                          {o.items.map((item, index) => (
                            <li key={`${item.product_name}-${index}`} className="flex min-w-0 items-baseline gap-1.5">
                              <span className="shrink-0 font-semibold tabular-nums text-foreground">{item.quantity}×</span>
                              <span className="truncate">{item.product_name}</span>
                            </li>
                          ))}
                        </ul>

                        {o.notes && (
                          <p className="mt-2 line-clamp-2 border-l-2 border-warning pl-2 text-xs text-muted-foreground">
                            {o.notes}
                          </p>
                        )}

                        {NEXT_STATUS[o.status] && (canOrderStatus || (canKdsStatus && NEXT_STATUS[o.status] !== "delivered")) && (
                          <button
                            onClick={() => advance(o)}
                            data-testid={`advance-${o.order_number}`}
                            className="mt-3 flex w-full cursor-pointer items-center justify-center gap-1 rounded border border-primary/30 px-2 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Avançar para {STATUS_LABEL[NEXT_STATUS[o.status]]} <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Informações de vendas e desempenho operacional do dia — só para quem enxerga
          faturamento. Indicadores de hoje vêm de GET /orders/stats (created_at/delivered_at,
          nunca reescritos) — operacionais de UM restaurante, não BI/comparação (isso fica
          no DACOT Hub). Não duplica o alerta de "20+ min em preparo" já existente acima. */}
      {SHOW_PERFORMANCE_SECTION && canSeeFinance && (
        <section>
          <SectionTitle>Vendas & desempenho hoje</SectionTitle>
          <div className="bg-card border rounded-none p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => setMetricDialog("revenue")}
              className="-m-1.5 cursor-pointer rounded-sm p-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="metric-revenue"
            >
              <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Faturamento hoje <ChevronRight className="w-3 h-3 opacity-60" />
              </div>
              <div className="mt-1 font-display text-2xl sm:text-3xl font-bold text-foreground">
                {stats ? brl(stats.today_revenue) : "—"}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMetricDialog("createdToday")}
              className="-m-1.5 cursor-pointer rounded-sm p-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="metric-orders-today"
            >
              <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Pedidos hoje <ChevronRight className="w-3 h-3 opacity-60" />
              </div>
              <div className="mt-1 font-display text-2xl font-semibold text-foreground">
                {stats ? stats.orders_created_today : "—"}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMetricDialog("deliveredToday")}
              className="-m-1.5 cursor-pointer rounded-sm p-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="metric-delivered-today"
            >
              <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Entregues hoje <ChevronRight className="w-3 h-3 opacity-60" />
              </div>
              <div className="mt-1 font-display text-2xl font-semibold text-foreground">
                {stats ? stats.orders_delivered_today : "—"}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMetricDialog("avgTime")}
              className="-m-1.5 cursor-pointer rounded-sm p-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="metric-avg-total-time-today"
            >
              <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Tempo total médio hoje <ChevronRight className="w-3 h-3 opacity-60" />
              </div>
              <div className="mt-1 font-display text-2xl font-semibold text-foreground">
                {stats && stats.avg_order_total_minutes_today != null ? formatDurationMinutes(stats.avg_order_total_minutes_today * 60000) : "—"}
              </div>
            </button>
          </div>
        </section>
      )}

      <DashboardMetricDialog open={!!metricDialog} onOpenChange={(v) => !v && setMetricDialog(null)} kind={metricDialog} />
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{children}</h2>;
}

function Indicator({ label, value, highlight = false, testid }) {
  return (
    <div className={`cursor-default bg-card border rounded-none p-4 shadow-none ${highlight ? "border-primary/40 bg-primary/10" : ""}`} data-testid={testid}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
