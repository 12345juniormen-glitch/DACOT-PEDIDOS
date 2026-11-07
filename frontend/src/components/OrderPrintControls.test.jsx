import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import OrderPrintControls, { OrderPrintDocument } from "./OrderPrintControls";
import { api } from "../lib/api";
import { brl } from "../lib/format";

jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));

const order = {
  id: "order-1",
  order_number: 4811,
  customer_name: "Mariana Souza",
  created_at: "2026-11-06T15:30:00-03:00",
  items: [
    { product_id: "burger", product_name: "X-Burger Artesanal", unit_price: 28.9, quantity: 2, line_total: 57.8, notes: "Sem cebola. Molho à parte." },
    { product_id: "juice", product_name: "Suco de Laranja", unit_price: 8.5, quantity: 1, line_total: 8.5, notes: "" },
  ],
  notes: "Entregar na recepção. Observação longa que deve permanecer legível e quebrar linha sem ser cortada durante a impressão.",
  subtotal: 66.3,
  discount_type: "fixed",
  discount_value: 5,
  discount_amount: 5,
  total: 61.3,
  status: "new",
};

describe("OrderPrintDocument", () => {
  test("comprovante usa os valores históricos registrados sem aviso fiscal", () => {
    const html = renderToStaticMarkup(
      <OrderPrintDocument order={order} restaurantName="Brasa do Centro" kind="receipt" paper="80" />,
    );

    expect(html).toContain("Brasa do Centro");
    expect(html).toContain("Pedido #4811");
    expect(html).toContain("X-Burger Artesanal");
    expect(html).toContain(brl(28.9));
    expect(html).toContain(brl(57.8));
    expect(html).toContain(brl(66.3));
    expect(html).toContain(brl(61.3));
    expect(html).not.toContain("DOCUMENTO SEM VALOR FISCAL");
    expect(html).toContain("data-paper=\"80\"");
  });

  test("comanda inclui cliente e observações, mas não imprime valores financeiros", () => {
    const html = renderToStaticMarkup(
      <OrderPrintDocument order={order} restaurantName="Brasa do Centro" kind="kitchen" paper="58" />,
    );

    expect(html).toContain("Mariana Souza");
    expect(html).toContain("Sem cebola. Molho à parte.");
    expect(html).toContain("Entregar na recepção.");
    expect(html).not.toContain("R$");
    expect(html).not.toContain("Subtotal");
    expect(html).not.toContain("Total");
    expect(html).toContain("data-paper=\"58\"");
  });

  test("comprovante inclui a logo configurada e aplica o preset escolhido", () => {
    const html = renderToStaticMarkup(
      <OrderPrintDocument order={order} restaurantName="Brasa do Centro" kind="receipt" paper="common" preset="minimal" logoDataUrl="data:image/png;base64,logo" />,
    );
    expect(html).toContain("class=\"print-logo\"");
    expect(html).toContain("data-preset=\"minimal\"");
  });

  test.each(["58", "80", "common"])("aceita configuração de papel %s", (paper) => {
    const html = renderToStaticMarkup(
      <OrderPrintDocument order={order} restaurantName="Brasa do Centro" kind="receipt" paper={paper} />,
    );
    expect(html).toContain(`data-paper=\"${paper}\"`);
  });
});

describe("OrderPrintControls", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api.get.mockResolvedValue({ data: { name: "Brasa do Centro" } });
    Object.defineProperty(window, "print", { configurable: true, value: jest.fn() });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  test("abre a impressão e permite reimprimir sem alterar o pedido", async () => {
    await act(async () => {
      root.render(<OrderPrintControls order={order} restaurantId="restaurant-1" />);
    });

    const button = container.querySelector('[data-testid="print-receipt"]');
    act(() => button.click());
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#dacot-print-root").textContent).toContain(brl(61.3));

    act(() => window.dispatchEvent(new Event("afterprint")));
    act(() => button.click());
    expect(window.print).toHaveBeenCalledTimes(2);
    expect(order.status).toBe("new");
    expect(order.total).toBe(61.3);
    expect(api.get).toHaveBeenCalledWith("/restaurant/current");
  });
});
