import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ChefHat, Play, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, formatApiError } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";

// KDS — visão exclusiva para cozinha.
// Mostra apenas pedidos em `new` e `in_preparation`.
// Ao marcar Pronto, o pedido sai da lista na próxima atualização.
export default function KitchenPage() {
  useDocumentTitle("Cozinha");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // order id currently being updated

  const load = async () => {
    setLoading(true);
    try {
      // Duas queries paralelas usando o GET /orders existente com filtro de status.
      const [nw, ip] = await Promise.all([
        api.get("/orders", { params: { status: "new" } }),
        api.get("/orders", { params: { status: "in_preparation" } }),
      ]);
      setOrders([...nw.data, ...ip.data]);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Auto-refresh a cada 15s — sem WebSocket, seguro e simples.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const grouped = useMemo(() => {
    const g = { new: [], in_preparation: [] };
    // ordena mais antigos primeiro (FIFO para cozinha)
    [...orders]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((o) => { if (g[o.status]) g[o.status].push(o); });
    return g;
  }, [orders]);

  const advance = async (o, nextStatus) => {
    setBusy(o.id);
    try {
      await api.patch(`/orders/${o.id}/status`, { status: nextStatus });
      toast.success(
        nextStatus === "in_preparation"
          ? `Pedido #${o.order_number}: preparo iniciado`
          : `Pedido #${o.order_number}: pronto para retirada`,
      );
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };

  const elapsedMin = (iso) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    return diff < 1 ? "agora" : `${diff} min`;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <ChefHat className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900">Cozinha</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {grouped.new.length} novo{grouped.new.length !== 1 ? "s" : ""} · {grouped.in_preparation.length} em preparo
            </p>
          </div>
        </div>
        <Button variant="outline" size="lg" onClick={load} disabled={loading} data-testid="refresh-kitchen-button">
          <RefreshCw className={`w-5 h-5 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coluna: Novos */}
        <section data-testid="column-kitchen-new" className="bg-white border-2 border-blue-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b-2 border-blue-200 bg-blue-50">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-blue-900">Novos</h2>
              <span className="text-2xl font-display font-bold text-blue-700" data-testid="count-new">{grouped.new.length}</span>
            </div>
          </div>
          <div className="p-4 space-y-4 min-h-[300px] max-h-[calc(100vh-260px)] overflow-y-auto">
            {grouped.new.length === 0 && (
              <div className="text-center text-base text-muted-foreground py-16">Nenhum pedido novo</div>
            )}
            {grouped.new.map((o) => (
              <KitchenCard key={o.id} order={o} elapsed={elapsedMin(o.created_at)}>
                <Button
                  size="lg"
                  className="w-full text-base h-12"
                  onClick={() => advance(o, "in_preparation")}
                  disabled={busy === o.id}
                  data-testid={`start-prep-${o.order_number}`}
                >
                  <Play className="w-5 h-5 mr-2" /> Iniciar preparo
                </Button>
              </KitchenCard>
            ))}
          </div>
        </section>

        {/* Coluna: Em preparo */}
        <section data-testid="column-kitchen-in-prep" className="bg-white border-2 border-orange-300 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b-2 border-orange-300 bg-orange-50">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-orange-900">Em preparo</h2>
              <span className="text-2xl font-display font-bold text-orange-700" data-testid="count-in-prep">{grouped.in_preparation.length}</span>
            </div>
          </div>
          <div className="p-4 space-y-4 min-h-[300px] max-h-[calc(100vh-260px)] overflow-y-auto">
            {grouped.in_preparation.length === 0 && (
              <div className="text-center text-base text-muted-foreground py-16">Nenhum pedido em preparo</div>
            )}
            {grouped.in_preparation.map((o) => (
              <KitchenCard key={o.id} order={o} elapsed={elapsedMin(o.created_at)} accent="orange">
                <Button
                  size="lg"
                  className="w-full text-base h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => advance(o, "ready")}
                  disabled={busy === o.id}
                  data-testid={`mark-ready-${o.order_number}`}
                >
                  <Check className="w-5 h-5 mr-2" /> Marcar como pronto
                </Button>
              </KitchenCard>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function KitchenCard({ order, elapsed, accent = "blue", children }) {
  return (
    <article
      data-testid={`kitchen-order-${order.order_number}`}
      className={`border rounded-lg overflow-hidden bg-white shadow-sm ${accent === "orange" ? "border-orange-200" : "border-slate-200"}`}
    >
      <header className="px-4 py-3 flex items-center justify-between bg-slate-50 border-b">
        <div className="font-display font-bold text-2xl text-slate-900">#{order.order_number}</div>
        <div className="flex items-center gap-1.5 text-sm text-slate-600">
          <Clock className="w-4 h-4" /> {formatTime(order.created_at)} · <span className="font-medium">{elapsed}</span>
        </div>
      </header>
      <div className="p-4 space-y-2">
        <ul className="space-y-2" data-testid={`items-${order.order_number}`}>
          {order.items.map((i, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center min-w-[2.5rem] h-9 px-2 rounded bg-slate-900 text-white font-display font-bold text-base">
                {i.quantity}×
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-base text-slate-900 leading-tight">{i.product_name}</div>
                {i.notes && (
                  <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 inline-block">
                    ⚑ {i.notes}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {order.notes && (
          <div className="mt-3 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900">
            <span className="font-semibold">Obs. do pedido: </span>{order.notes}
          </div>
        )}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </article>
  );
}
