import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw, ChevronRight, Clock, ChefHat, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { api, formatApiError } from "@/lib/api";
import { brl, formatTime, STATUS_LABEL, NEXT_STATUS } from "@/lib/format";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";

const COLUMNS = [
  { key: "new", label: "Novo" },
  { key: "in_preparation", label: "Em preparo" },
  { key: "ready", label: "Pronto" },
];

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
          className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 hover:bg-orange-100 transition-colors"
          data-testid="kitchen-shortcut-banner"
        >
          <span className="flex items-center gap-2.5 text-sm font-medium text-orange-900">
            <ChefHat className="w-4 h-4" /> Sua tela de trabalho é a Cozinha — pedidos por ticket, botões grandes.
          </span>
          <ArrowRight className="w-4 h-4 text-orange-700 shrink-0" />
        </Link>
      )}

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
            <div key={col.key} className="bg-white border rounded-lg overflow-hidden flex flex-col" data-testid={`column-${col.key}`}>
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
                  <div key={o.id} className="border rounded-md p-3 hover:border-slate-300 bg-white" data-testid={`order-card-${o.order_number}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <Link to={`/pedidos/${o.id}`} className="font-display font-semibold text-slate-900 hover:text-primary">
                        #{o.order_number}
                      </Link>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatTime(o.created_at)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-700 truncate">
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

      {/* Informações de vendas — só para quem enxerga faturamento */}
      {canSeeFinance && (
        <section>
          <SectionTitle>Vendas</SectionTitle>
          <div className="bg-white border rounded-lg p-4 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Faturamento hoje</div>
              <div className="mt-1 font-display text-3xl font-bold text-slate-900" data-testid="metric-revenue">
                {stats ? brl(stats.today_revenue) : "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Entregues</div>
              <div className="mt-1 font-display text-2xl font-semibold text-slate-700" data-testid="metric-delivered">
                {stats ? stats.delivered : "—"}
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
    <div className={`bg-white border rounded-lg p-4 ${highlight ? "border-primary/40 bg-accent/30" : ""}`} data-testid={testid}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${highlight ? "text-primary" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
