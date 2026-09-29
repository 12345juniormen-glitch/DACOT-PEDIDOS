import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Clock, Plus, RefreshCw, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { api, formatApiError } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { groupWaiterOrders, waiterElapsedMinutes } from "@/lib/waiterOrders";
import { toast } from "sonner";

export default function WaiterPage() {
  useDocumentTitle("Garçom");
  const { user } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasPermission(user, "orders.create");
  const canView = hasPermission(user, "orders.view");
  const canChangeStatus = hasPermission(user, "orders.status");
  const canCancel = hasPermission(user, "orders.cancel");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { data } = await api.get("/orders", { params: { active_only: true } });
      setOrders(data);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const refreshTimer = setInterval(() => load(true), 15000);
    const clockTimer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(refreshTimer);
      clearInterval(clockTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intervalos únicos durante a montagem
  }, []);

  const grouped = useMemo(() => groupWaiterOrders(orders), [orders]);

  const changeStatus = async (order, status) => {
    setBusy(order.id);
    try {
      await api.patch(`/orders/${order.id}/status`, { status });
      toast.success(status === "delivered" ? `Pedido #${order.order_number} entregue` : `Pedido #${order.order_number} cancelado`);
      await load(true);
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-3 py-4 sm:px-6 sm:py-6 pb-24">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-display font-bold tracking-tight">Garçom</h1>
        <button onClick={() => load()} disabled={loading} aria-label="Atualizar pedidos" className="p-3 rounded-md border text-muted-foreground hover:bg-muted">
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {canCreate && <Button onClick={() => navigate("/garcom/novo")} className="w-full h-14 text-base font-bold mb-6" data-testid="waiter-new-order">
        <Plus className="w-5 h-5 mr-2" /> Novo pedido
      </Button>}

      <OrderSection
        title="Em andamento"
        orders={grouped.inProgress}
        empty="Nenhum pedido em andamento."
        now={now}
        canView={canView}
        canCancel={canCancel}
        busy={busy}
        onOpen={(order) => navigate(`/pedidos/${order.id}`)}
        onCancel={(order) => changeStatus(order, "cancelled")}
      />

      <OrderSection
        title="Prontos"
        orders={grouped.ready}
        empty="Nenhum pedido aguardando retirada."
        ready
        now={now}
        canView={canView}
        canChangeStatus={canChangeStatus}
        canCancel={canCancel}
        busy={busy}
        onOpen={(order) => navigate(`/pedidos/${order.id}`)}
        onDeliver={(order) => changeStatus(order, "delivered")}
        onCancel={(order) => changeStatus(order, "cancelled")}
      />
    </div>
  );
}

function OrderSection({ title, orders, empty, ready = false, now, canView, canChangeStatus, canCancel, busy, onOpen, onDeliver, onCancel }) {
  return <section className="mb-7">
    <div className="flex items-center justify-between mb-2 px-1">
      <h2 className={`text-sm font-bold uppercase tracking-wide ${ready && orders.length ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>{title}</h2>
      <span className="text-sm font-semibold tabular-nums">{orders.length}</span>
    </div>
    <div className={`divide-y rounded-lg border overflow-hidden ${ready && orders.length ? "border-emerald-500 dark:border-emerald-700" : "border-border"}`}>
      {orders.length === 0 && <p className="px-4 py-6 text-sm text-center text-muted-foreground">{empty}</p>}
      {orders.map((order) => {
        const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
        return <article key={order.id} className={ready ? "bg-emerald-50 dark:bg-emerald-950/50" : "bg-card"}>
          <button type="button" disabled={!canView} onClick={() => canView && onOpen(order)} className="w-full min-h-24 px-4 py-3 flex items-center gap-3 text-left disabled:cursor-default">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-display text-xl font-bold">#{order.order_number}</span>
                <span className={`text-sm font-semibold ${ready ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"}`}>{STATUS_LABEL[order.status]}</span>
              </div>
              <div className="font-medium truncate mt-1">{order.customer_name || "Sem cliente"}</div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                <span>{itemCount} {itemCount === 1 ? "item" : "itens"}</span>
                <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {waiterElapsedMinutes(order, now)} min</span>
              </div>
            </div>
            {canView && <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />}
          </button>
          {(canCancel || (ready && canChangeStatus)) && <div className="flex gap-2 px-3 pb-3">
            {canCancel && <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="outline" disabled={busy === order.id} className="h-11 flex-1 text-destructive"><XCircle className="w-4 h-4 mr-1.5" /> Cancelar</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Cancelar pedido #{order.order_number}?</AlertDialogTitle><AlertDialogDescription>O pedido será movido para o histórico como cancelado.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Manter pedido</AlertDialogCancel><AlertDialogAction onClick={() => onCancel(order)}>Cancelar pedido</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>}
            {ready && canChangeStatus && <Button onClick={() => onDeliver(order)} disabled={busy === order.id} className="h-11 flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white"><Check className="w-5 h-5 mr-1.5" /> Marcar entregue</Button>}
          </div>}
        </article>;
      })}
    </div>
  </section>;
}
