import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw, ChevronRight, Clock, ChefHat, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge, STATUS_ICON } from "@/components/StatusBadge";
import { api, formatApiError } from "@/lib/api";
import { brl, formatTime, STATUS_LABEL, NEXT_STATUS } from "@/lib/format";
import { formatDurationMinutes } from "@/lib/orderTimeline";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";

const COLUMNS = [
  { key: "new", label: "Novo" },
  { key: "in_preparation", label: "Em preparo" },
  { key: "ready", label: "Pronto" },
];

// Mesmo limiar do destaque de atenção do KDS (frontend/src/pages/KitchenPage.jsx):
// 20min+ em preparo. updated_at só muda em transição real de status (backend/modules/
// orders/routes.py), nunca por edição de conteúdo — por isso é seguro usá-lo aqui também.
const ATTENTION_THRESHOLD_MS = 20 * 60 * 1000;

export default function DashboardPage() {
  useDocumentTitle("Dashboard");
  const { user } = useAuth();
  const canSeeFinance = user && (user.role === "admin" || user.role === "manager");
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

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
    if (!next) return;
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
            <Link to="/pedidos/novo">
              <Button data-testid="create-order-button" size="sm">
                <Plus className="w-4 h-4 mr-1.5" /> Novo Pedido
              </Button>
            </Link>
          </>
        }
      />

      {user?.role === "kitchen" && (
        <Link
          to="/cozinha"
          className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950 dark:hover:bg-orange-900 transition-colors"
          data-testid="kitchen-shortcut-banner"
        >
          <span className="flex items-center gap-2.5 text-sm font-medium text-orange-900 dark:text-orange-200">
            <ChefHat className="w-4 h-4" /> Sua tela de trabalho é a Cozinha — pedidos por ticket, botões grandes.
          </span>
          <ArrowRight className="w-4 h-4 text-orange-700 dark:text-orange-400 shrink-0" />
        </Link>
      )}

      {/* Operação agora — resumo por status para quem não abre a Cozinha (ex.: gerente),
          com os mesmos pedidos ativos já carregados e o mesmo limiar de atenção do KDS. */}
      <section className="mb-6" data-testid="ops-now">
        <SectionTitle>Operação agora</SectionTitle>
        <div className="flex flex-col sm:flex-row gap-3">
          {COLUMNS.map((col) => {
            const Icon = STATUS_ICON[col.key];
            return (
              <div
                key={col.key}
                className="flex-1 bg-card border rounded-lg px-4 py-3 flex items-center justify-between gap-3"
                data-testid={`ops-now-${col.key}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {Icon && <Icon className="w-4 h-4 text-muted-foreground" />} {col.label}
                </span>
                <span className="font-display text-xl font-bold text-foreground">{byStatus[col.key].length}</span>
              </div>
            );
          })}
        </div>
        {attentionCount > 0 && (
          <div
            className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-200"
            data-testid="ops-now-attention"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <span className="font-semibold">⚠ Atenção · </span>
              {attentionCount} pedido{attentionCount !== 1 ? "s" : ""} em preparo há mais de 20 min
            </span>
          </div>
        )}
      </section>

      {/* Indicadores principais — sempre corretos para qualquer papel, calculados a partir dos pedidos ativos já
          carregados (não repetem a contagem por status, que já aparece nas colunas logo abaixo) */}
      <div className="grid grid-cols-2 gap-3 mb-6 max-w-md">
        <Indicator label="Pedidos ativos" value={activeTotal} testid="metric-active" />
        <Indicator label="Prontos p/ entrega" value={byStatus.ready.length} highlight={byStatus.ready.length > 0} testid="metric-ready" />
      </div>

      {/* Situação atual dos pedidos */}
      <section className="mb-6">
        <SectionTitle>Situação atual dos pedidos</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {COLUMNS.map((col) => (
            <div key={col.key} className="bg-card border rounded-lg overflow-hidden flex flex-col" data-testid={`column-${col.key}`}>
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={col.key} />
                  <span className="text-xs text-muted-foreground">
                    {byStatus[col.key].length} pedido{byStatus[col.key].length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <div className="p-3 space-y-2 min-h-[160px] max-h-[calc(100vh-420px)] overflow-y-auto">
                {byStatus[col.key].length === 0 && (
                  <div className="text-center text-sm text-muted-foreground py-10">Sem pedidos</div>
                )}
                {byStatus[col.key].map((o) => (
                  <div key={o.id} className="border rounded-md p-3 hover:border-slate-300 dark:hover:border-slate-600 bg-card" data-testid={`order-card-${o.order_number}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <Link to={`/pedidos/${o.id}`} className="font-display font-semibold text-foreground hover:text-primary">
                        #{o.order_number}
                      </Link>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatTime(o.created_at)}
                      </span>
                    </div>
                    <div className="text-sm text-foreground truncate">
                      {o.customer_name || <span className="text-muted-foreground italic">Sem cliente</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {o.items.length} ite{o.items.length !== 1 ? "ns" : "m"} · {brl(o.total)}
                    </div>
                    {NEXT_STATUS[o.status] && (
                      <button
                        onClick={() => advance(o)}
                        data-testid={`advance-${o.order_number}`}
                        className="mt-2 w-full text-xs font-medium text-primary hover:bg-accent rounded px-2 py-2.5 flex items-center justify-center gap-1"
                      >
                        Avançar para {STATUS_LABEL[NEXT_STATUS[o.status]]} <ChevronRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!loading && orders.length === 0 && (
          <div className="mt-4">
            <EmptyState title="Nenhum pedido ativo no momento" description="Novos pedidos aparecem aqui assim que forem criados." />
          </div>
        )}
      </section>

      {/* Informações de vendas e desempenho operacional do dia — só para quem enxerga
          faturamento. Indicadores de hoje vêm de GET /orders/stats (created_at/delivered_at,
          nunca reescritos) — operacionais de UM restaurante, não BI/comparação (isso fica
          no DACOT Hub). Não duplica o alerta de "20+ min em preparo" já existente acima. */}
      {canSeeFinance && (
        <section>
          <SectionTitle>Vendas & desempenho hoje</SectionTitle>
          <div className="bg-card border rounded-lg p-4 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Faturamento hoje</div>
              <div className="mt-1 font-display text-3xl font-bold text-foreground" data-testid="metric-revenue">
                {stats ? brl(stats.today_revenue) : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Entregues (total)</div>
              <div className="mt-1 font-display text-2xl font-semibold text-foreground" data-testid="metric-delivered">
                {stats ? stats.delivered : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pedidos hoje</div>
              <div className="mt-1 font-display text-2xl font-semibold text-foreground" data-testid="metric-orders-today">
                {stats ? stats.orders_created_today : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Entregues hoje</div>
              <div className="mt-1 font-display text-2xl font-semibold text-foreground" data-testid="metric-delivered-today">
                {stats ? stats.orders_delivered_today : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Tempo total médio hoje</div>
              <div className="mt-1 font-display text-2xl font-semibold text-foreground" data-testid="metric-avg-total-time-today">
                {stats && stats.avg_order_total_minutes_today != null ? formatDurationMinutes(stats.avg_order_total_minutes_today * 60000) : "—"}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{children}</h2>;
}

function Indicator({ label, value, highlight = false, testid }) {
  return (
    <div className={`bg-card border rounded-lg p-4 ${highlight ? "border-primary/40 bg-accent/30" : ""}`} data-testid={testid}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
