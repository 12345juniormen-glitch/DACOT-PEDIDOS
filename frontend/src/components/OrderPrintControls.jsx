import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { ChefHat, ReceiptText } from "lucide-react";
import { api } from "../lib/api";
import { brl, formatDateTime } from "../lib/format";
import "./OrderPrint.css";

const PAPER_WIDTHS = new Set(["58", "80", "common"]);

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function OrderPrintDocument({ order, restaurantName, kind, paper, preset = "classic", logoDataUrl }) {
  if (!order || !kind) return null;
  const isReceipt = kind === "receipt";

  return (
    <div id="dacot-print-root" data-paper={PAPER_WIDTHS.has(paper) ? paper : "80"}>
      <article className={`print-document ${isReceipt ? "print-receipt" : "print-kitchen-ticket"}`} data-preset={preset}>
        <header className="print-header">
          {isReceipt && logoDataUrl && <img className="print-logo" src={logoDataUrl} alt="Logo do restaurante" />}
          {isReceipt && safeText(restaurantName) && <h1>{restaurantName}</h1>}
          <div className="print-order-number">Pedido #{order.order_number}</div>
          <div className="print-meta">{formatDateTime(order.created_at)}</div>
          {!isReceipt && safeText(order.customer_name) && (
            <div className="print-meta">Cliente: {order.customer_name}</div>
          )}
        </header>

        <div className="print-rule" />
        <section aria-label="Itens do pedido" className="print-items">
          {order.items.map((item, index) => (
            <div className="print-item" key={`${item.product_id || item.product_name}-${index}`}>
              <div className="print-item-main">
                <span className="print-quantity">{item.quantity}×</span>
                <span className="print-product-name">{item.product_name}</span>
              </div>
              {isReceipt && (
                <div className="print-item-prices">
                  <span>{brl(item.unit_price)} / un.</span>
                  <strong>{brl(item.line_total)}</strong>
                </div>
              )}
              {safeText(item.notes) && <p className="print-note">Obs.: {item.notes}</p>}
            </div>
          ))}
        </section>

        {safeText(order.notes) && (
          <section className="print-order-notes">
            <strong>Observações do pedido</strong>
            <p>{order.notes}</p>
          </section>
        )}

        {isReceipt && (
          <>
            <div className="print-rule" />
            <section className="print-totals" aria-label="Valores do pedido">
              <div><span>Subtotal</span><span>{brl(order.subtotal)}</span></div>
              {Number(order.discount_amount) > 0 && (
                <div><span>Desconto{order.discount_type === "percent" ? ` (${order.discount_value}%)` : ""}</span><span>− {brl(order.discount_amount)}</span></div>
              )}
              <div className="print-grand-total"><strong>Total</strong><strong>{brl(order.total)}</strong></div>
            </section>
            {safeText(order.payment_method) && (
              <div className="print-payment">Pagamento: {order.payment_method}</div>
            )}
          </>
        )}
      </article>
    </div>
  );
}

export default function OrderPrintControls({ order, restaurantId, fallbackRestaurantName = "" }) {
  const [restaurantName, setRestaurantName] = useState(fallbackRestaurantName);
  const [receiptSettings, setReceiptSettings] = useState({ preset: "classic", logo_data_url: null });
  const [settingsLoading, setSettingsLoading] = useState(Boolean(restaurantId));
  const [paper, setPaper] = useState("80");
  const [printJob, setPrintJob] = useState(null);

  useEffect(() => {
    let current = true;
    if (!restaurantId) return () => { current = false; };
    api.get("/restaurant/current")
      .then(({ data }) => {
        if (current && data?.name) setRestaurantName(data.name);
      })
      .catch(() => {});
    return () => { current = false; };
  }, [restaurantId]);

  useEffect(() => {
    let current = true;
    if (!restaurantId) {
      setSettingsLoading(false);
      return () => { current = false; };
    }
    setSettingsLoading(true);
    api.get("/restaurant/print-settings")
      .then(({ data }) => {
        if (current) setReceiptSettings({
          preset: data?.preset || "classic",
          logo_data_url: data?.logo_data_url || null,
        });
      })
      .catch(() => {})
      .finally(() => { if (current) setSettingsLoading(false); });
    return () => { current = false; };
  }, [restaurantId]);

  useEffect(() => {
    const clearPrintDocument = () => setPrintJob(null);
    window.addEventListener("afterprint", clearPrintDocument);
    return () => window.removeEventListener("afterprint", clearPrintDocument);
  }, []);

  const print = (kind) => {
    if (printJob) return;
    flushSync(() => setPrintJob({ kind, paper }));
    try {
      window.print();
    } catch (_) {
      flushSync(() => setPrintJob(null));
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Impressão do pedido">
        <label className="sr-only" htmlFor="order-print-paper">Formato do papel</label>
        <select
          id="order-print-paper"
          aria-label="Formato do papel"
          className="h-9 rounded-sm border border-input bg-background px-2 text-sm text-foreground"
          value={paper}
          onChange={(event) => setPaper(event.target.value)}
          disabled={Boolean(printJob) || settingsLoading}
        >
          <option value="58">Térmica 58 mm</option>
          <option value="80">Térmica 80 mm</option>
          <option value="common">Papel comum</option>
        </select>
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-sm border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          onClick={() => print("receipt")}
          disabled={Boolean(printJob) || settingsLoading}
          data-testid="print-receipt"
        >
          <ReceiptText className="mr-1.5 h-4 w-4" /> Imprimir comprovante
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center rounded-sm border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          onClick={() => print("kitchen")}
          disabled={Boolean(printJob)}
          data-testid="print-kitchen-ticket"
        >
          <ChefHat className="mr-1.5 h-4 w-4" /> Imprimir comanda
        </button>
        {(printJob || settingsLoading) && <span className="sr-only" role="status">{settingsLoading ? "Carregando configurações de impressão" : "Preparando impressão"}</span>}
      </div>
      <OrderPrintDocument
        order={order}
        restaurantName={restaurantName || fallbackRestaurantName}
        preset={receiptSettings.preset}
        logoDataUrl={receiptSettings.logo_data_url}
        kind={printJob?.kind}
        paper={printJob?.paper || paper}
      />
    </>
  );
}
