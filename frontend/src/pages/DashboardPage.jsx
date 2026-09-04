import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [stats, setStats] = useState({ new: 0, in_preparation: 0, ready: 0, delivered: 0, cancelled: 0, today_revenue: 0 });
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
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Pedidos ativos por status</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading} data-testid="refresh-orders-button" size="sm">
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Link to="/pedidos/novo">
            <Button data-testid="create-order-button" size="sm">
              <Plus className="w-4 h-4 mr-1.5" /> Novo Pedido
            </Button>
          </Link>
        </div>
      </header>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <MetricCard label="Novos" value={stats.new} testid="metric-new" tone="blue" />
        <MetricCard label="Em preparo" value={stats.in_preparation} testid="metric-in-prep" tone="orange" />
        <MetricCard label="Prontos" value={stats.ready} testid="metric-ready" tone="green" />
        <MetricCard label="Entregues" value={stats.delivered} testid="metric-delivered" tone="slate" />
        {canSeeFinance && <MetricCard label="Faturamento hoje" value={brl(stats.today_revenue)} testid="metric-revenue" tone="orange" isMoney />}
      </div>

      {/* Kanban */}
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
            <div className="p-3 space-y-2 min-h-[200px] max-h-[calc(100vh-360px)] overflow-y-auto">
              {byStatus[col.key].length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-10">Sem pedidos</div>
              )}
              {byStatus[col.key].map((o) => (
                <div key={o.id} className="border rounded-md p-3 hover:shadow-sm bg-white" data-testid={`order-card-${o.order_number}`}>
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
      {loading && orders.length === 0 && (
        <div className="text-center text-sm text-muted-foreground mt-8">Carregando…</div>
      )}
    </div>
  );
}

function MetricCard({ label, value, testid, tone = "slate", isMoney }) {
  const tones = {
    blue: "text-blue-600",
    orange: "text-primary",
    green: "text-emerald-600",
    slate: "text-slate-700",
  };
  return (
    <Card data-testid={testid} className="border shadow-sm">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className={`mt-1 font-display ${isMoney ? "text-xl" : "text-2xl"} font-bold ${tones[tone]}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
