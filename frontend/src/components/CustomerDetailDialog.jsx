import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { api, formatApiError } from "@/lib/api";
import { brl, formatDateTime } from "@/lib/format";
import { toast } from "sonner";

/**
 * Detalhe do cliente + histórico de pedidos. Não duplica nem agrega dado de
 * pedido no cliente — busca o histórico direto de GET /orders?customer_id=
 * (tenant-scoped no backend) toda vez que abre.
 */
export function CustomerDetailDialog({ open, onOpenChange, customer }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !customer) return;
    // Zera antes de buscar: nunca mostra o histórico do cliente anterior enquanto
    // carrega ou se a busca falhar. `cancelled` ignora uma resposta que chegue
    // depois que o dialog já mudou de cliente (ou fechou).
    let cancelled = false;
    setOrders([]);
    setError(false);
    setLoading(true);
    api
      .get("/orders", { params: { customer_id: customer.id } })
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
  }, [open, customer]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="customer-detail-dialog">
        {customer && (
          <>
            <DialogHeader>
              <DialogTitle data-testid="customer-detail-name">{customer.name}</DialogTitle>
            </DialogHeader>

            <div className="flex items-center gap-1.5 text-sm text-muted-foreground -mt-2">
              <Phone className="w-3.5 h-3.5" />
              {customer.phone || "Sem telefone cadastrado"}
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Histórico de pedidos
              </div>

              {loading && <div className="text-sm text-muted-foreground py-8 text-center">Carregando…</div>}

              {!loading && error && (
                <EmptyState icon={ClipboardList} title="Não foi possível carregar o histórico deste cliente." compact />
              )}

              {!loading && !error && orders.length === 0 && (
                <EmptyState icon={ClipboardList} title="Este cliente ainda não possui pedidos." compact />
              )}

              {!loading && !error && orders.length > 0 && (
                <div className="space-y-2" data-testid="customer-orders-list">
                  {orders.map((o) => (
                    <Link
                      key={o.id}
                      to={`/pedidos/${o.id}`}
                      onClick={() => onOpenChange(false)}
                      className="block border rounded-md p-3 hover:border-primary/40 hover:bg-accent/30 transition-colors"
                      data-testid={`customer-order-${o.order_number}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-display font-semibold text-foreground">#{o.order_number}</span>
                        <StatusBadge status={o.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mb-1.5">{formatDateTime(o.created_at)}</div>
                      <div className="text-sm text-foreground truncate">
                        {o.items.map((i) => `${i.quantity}x ${i.product_name}`).join(", ")}
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-1.5">{brl(o.total)}</div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
