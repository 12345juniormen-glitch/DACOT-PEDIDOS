import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy, RotateCcw, XCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { api, formatApiError } from "@/lib/api";
import { brl, formatDateTime, STATUS_LABEL, STATUS_ORDER } from "@/lib/format";
import { toast } from "sonner";

// Mirrors backend ALLOWED_TRANSITIONS (backend/modules/orders/routes.py).
const TRANSITIONS = {
  new: ["in_preparation", "cancelled"],
  in_preparation: ["new", "ready", "cancelled"],
  ready: ["in_preparation", "delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

// Single-step rollback within the active kitchen pipeline — delivered/cancelled stay terminal.
const PREV_STATUS = {
  in_preparation: "new",
  ready: "in_preparation",
};

const NEXT_STATUS = {
  new: "in_preparation",
  in_preparation: "ready",
  ready: "delivered",
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/orders/${id}`);
      setOrder(data);
    } catch (e) {
      toast.error(formatApiError(e));
      nav("/");
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      await api.patch(`/orders/${id}/status`, { status });
      toast.success(`Status atualizado: ${STATUS_LABEL[status]}`);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/orders/${id}/duplicate`);
      toast.success(`Pedido duplicado como #${data.order_number}`);
      nav(`/pedidos/${data.id}`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!order) return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;

  const editable = order.status === "new" || order.status === "in_preparation";
  const cancellable = TRANSITIONS[order.status].includes("cancelled");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => nav(-1)} data-testid="back-button">
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pedido</div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-slate-900" data-testid="order-number">
            #{order.order_number}
          </h1>
          <div className="text-sm text-muted-foreground mt-1">
            {formatDateTime(order.created_at)} · {order.customer_name || <span className="italic">Sem cliente</span>}
          </div>
          <div className="mt-3"><StatusBadge status={order.status} /></div>
        </div>

        <div className="flex flex-wrap gap-2">
          {editable && (
            <Link to={`/pedidos/${order.id}/editar`}>
              <Button variant="outline" size="sm" data-testid="edit-order-button">
                <Pencil className="w-4 h-4 mr-1.5" /> Editar
              </Button>
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={duplicate} disabled={busy} data-testid="duplicate-order-button">
            <Copy className="w-4 h-4 mr-1.5" /> Duplicar
          </Button>
          {cancellable && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-rose-50" data-testid="cancel-order-button">
                  <XCircle className="w-4 h-4 mr-1.5" /> Cancelar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancelar pedido #{order.order_number}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O pedido continuará visível no histórico com status "Cancelado". Esta ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="cancel-dialog-close">Manter pedido</AlertDialogCancel>
                  <AlertDialogAction onClick={() => changeStatus("cancelled")} data-testid="confirm-cancel-order">
                    Sim, cancelar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </header>

      {/* Status advance/rollback actions */}
      {(PREV_STATUS[order.status] || NEXT_STATUS[order.status]) && (
        <Card className="mb-6">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            {PREV_STATUS[order.status] && (
              <>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Voltar para</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => changeStatus(PREV_STATUS[order.status])}
                  disabled={busy}
                  data-testid={`revert-to-${PREV_STATUS[order.status]}`}
                >
                  <RotateCcw className="w-4 h-4 mr-1.5" /> {STATUS_LABEL[PREV_STATUS[order.status]]}
                </Button>
              </>
            )}
            {NEXT_STATUS[order.status] && (
              <>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold sm:ml-2">Avançar para</div>
                <Button
                  size="sm"
                  onClick={() => changeStatus(NEXT_STATUS[order.status])}
                  disabled={busy}
                  data-testid={`advance-to-${NEXT_STATUS[order.status]}`}
                >
                  {STATUS_LABEL[NEXT_STATUS[order.status]]}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Items */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wider text-muted-foreground">Itens</div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
              <th className="px-4 py-2 font-semibold">Produto</th>
              <th className="px-4 py-2 font-semibold text-right">Preço unit.</th>
              <th className="px-4 py-2 font-semibold text-right">Qtd</th>
              <th className="px-4 py-2 font-semibold text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i, idx) => (
              <tr key={idx} className="border-b last:border-0" data-testid={`order-item-${idx}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{i.product_name}</div>
                  {i.notes && <div className="text-xs text-muted-foreground mt-0.5">{i.notes}</div>}
                </td>
                <td className="px-4 py-3 text-right text-slate-700">{brl(i.unit_price)}</td>
                <td className="px-4 py-3 text-right">{i.quantity}</td>
                <td className="px-4 py-3 text-right font-medium">{brl(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="px-4 py-3 border-t bg-slate-50/50">
          {order.notes && (
            <div className="text-sm text-slate-700 mb-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mr-2">Obs:</span>
              {order.notes}
            </div>
          )}
          <div className="flex justify-end">
            <div className="w-full sm:w-72 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span><span>{brl(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Desconto {order.discount_type === "percent" ? `(${order.discount_value}%)` : ""}</span>
                <span>− {brl(order.discount_amount)}</span>
              </div>
              <div className="flex justify-between font-display text-lg font-bold text-slate-900 border-t pt-1.5">
                <span>Total</span><span data-testid="order-total">{brl(order.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
