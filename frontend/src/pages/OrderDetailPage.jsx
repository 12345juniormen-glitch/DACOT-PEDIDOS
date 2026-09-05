import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy, RotateCcw, XCircle, Pencil, Circle } from "lucide-react";
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
import { StatusBadge, STATUS_ICON } from "@/components/StatusBadge";
import { api, formatApiError } from "@/lib/api";
import { brl, formatDateTime, formatTime, STATUS_LABEL, STATUS_ORDER } from "@/lib/format";
import { buildTimelineEvents, computeTotalDurationMs, computeUntilCurrentDurationMs, formatDurationMinutes } from "@/lib/orderTimeline";
import { useDocumentTitle } from "@/hooks/use-document-title";
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
  useDocumentTitle(order ? `Pedido #${order.order_number}` : "Pedido");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deve rodar só quando o id muda; load muda a cada render
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

  const timelineEvents = buildTimelineEvents(order).map((ev) => ({
    ...ev,
    icon: ev.status ? STATUS_ICON[ev.status] : Circle,
  }));
  const totalDurationMs = computeTotalDurationMs(order);
  const totalDuration = totalDurationMs != null ? formatDurationMinutes(totalDurationMs) : null;
  const untilCurrentDurationMs = computeUntilCurrentDurationMs(order);
  const untilCurrentDuration = untilCurrentDurationMs != null ? formatDurationMinutes(untilCurrentDurationMs) : null;
  const currentStageLabel = timelineEvents[timelineEvents.length - 1]?.label;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => nav(-1)} data-testid="back-button" className="-ml-2 mb-3">
        <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pedido</div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground" data-testid="order-number">
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
                <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-rose-50 dark:hover:bg-rose-950" data-testid="cancel-order-button">
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

      {/* Linha do tempo — só eventos que os dados atuais permitem afirmar com certeza */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Linha do tempo</div>
          <ol className="space-y-3" data-testid="order-timeline">
            {timelineEvents.map((ev, idx) => {
              const Icon = ev.icon;
              return (
                <li key={idx} className="flex items-center gap-3" data-testid={`timeline-event-${idx}`}>
                  <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                    {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
                  </span>
                  <span className="flex-1 min-w-0 text-sm font-medium text-foreground">{ev.label}</span>
                  <span className="text-sm text-muted-foreground shrink-0">{formatTime(ev.at)}</span>
                </li>
              );
            })}
          </ol>
          {(totalDuration || untilCurrentDuration) && (
            <div className="mt-4 pt-3 border-t flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {totalDuration && (
                <div data-testid="timeline-total-duration">
                  <span className="text-muted-foreground">Tempo total: </span>
                  <span className="font-medium text-foreground">{totalDuration}</span>
                </div>
              )}
              {untilCurrentDuration && (
                <div data-testid="timeline-until-current-duration">
                  <span className="text-muted-foreground">Tempo até {currentStageLabel}: </span>
                  <span className="font-medium text-foreground">{untilCurrentDuration}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <div className="bg-card border rounded-lg overflow-hidden">
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
                  <div className="font-medium text-foreground">{i.product_name}</div>
                  {i.notes && <div className="text-xs text-muted-foreground mt-0.5">{i.notes}</div>}
                </td>
                <td className="px-4 py-3 text-right text-foreground">{brl(i.unit_price)}</td>
                <td className="px-4 py-3 text-right">{i.quantity}</td>
                <td className="px-4 py-3 text-right font-medium">{brl(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="px-4 py-3 border-t bg-muted/50">
          {order.notes && (
            <div className="text-sm text-foreground mb-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mr-2">Obs:</span>
              {order.notes}
            </div>
          )}
          <div className="flex justify-end">
            <div className="w-full sm:w-72 space-y-2">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span><span>{brl(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Desconto {order.discount_type === "percent" ? `(${order.discount_value}%)` : ""}</span>
                  <span>− {brl(order.discount_amount)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md bg-accent/50 border border-primary/20 px-3 py-2.5">
                <span className="text-sm font-semibold text-foreground">Total</span>
                <span className="font-display text-xl font-bold text-primary" data-testid="order-total">{brl(order.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
