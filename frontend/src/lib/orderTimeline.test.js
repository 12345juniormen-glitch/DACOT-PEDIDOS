import {
  buildTimelineEvents,
  computeTotalDurationMs,
  computeUntilCurrentDurationMs,
  formatDurationMinutes,
} from "./orderTimeline";

const baseOrder = {
  created_at: "2026-01-01T19:04:00.000Z",
};

describe("buildTimelineEvents", () => {
  test("pedido novo: só 'Pedido criado' (não duplica o mesmo horário como 'Novo')", () => {
    const order = { ...baseOrder, status: "new" };
    const events = buildTimelineEvents(order);
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Pedido criado");
  });

  test("em preparo: mostra 'Pedido criado' + 'Em preparo' com updated_at", () => {
    const order = { ...baseOrder, status: "in_preparation", updated_at: "2026-01-01T19:08:00.000Z" };
    const events = buildTimelineEvents(order);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ label: "Em preparo", at: order.updated_at, status: "in_preparation" });
  });

  test("pronto após rollback (ready->in_preparation->ready): não reconstrói o 'Pronto' anterior perdido", () => {
    // updated_at reflete só a transição mais recente para "ready" — o horário do primeiro
    // "Pronto" (antes do rollback) já não existe em lugar nenhum, e a timeline não pode
    // inventá-lo. Isso é o comportamento correto, não um bug.
    const order = { ...baseOrder, status: "ready", updated_at: "2026-01-01T19:30:00.000Z" };
    const events = buildTimelineEvents(order);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ label: "Pronto", at: "2026-01-01T19:30:00.000Z", status: "ready" });
    // nenhum evento "Em preparo" ou "Pronto" anterior foi inventado
    expect(events.some((e) => e.at !== order.created_at && e.at !== order.updated_at)).toBe(false);
  });

  test("entregue: usa delivered_at, não updated_at", () => {
    const order = {
      ...baseOrder,
      status: "delivered",
      updated_at: "2026-01-01T19:24:00.000Z",
      delivered_at: "2026-01-01T19:24:00.000Z",
    };
    const events = buildTimelineEvents(order);
    expect(events[1]).toMatchObject({ label: "Entregue", at: order.delivered_at, status: "delivered" });
  });

  test("entregue sem delivered_at (pedido antigo/dado incompleto): não inventa o evento", () => {
    const order = { ...baseOrder, status: "delivered", updated_at: "2026-01-01T19:24:00.000Z", delivered_at: null };
    const events = buildTimelineEvents(order);
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Pedido criado");
  });

  test("cancelado: usa cancelled_at, não inventa etapa anterior (ex.: 'Em preparo')", () => {
    const order = { ...baseOrder, status: "cancelled", updated_at: "2026-01-01T19:15:00.000Z", cancelled_at: "2026-01-01T19:15:00.000Z" };
    const events = buildTimelineEvents(order);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ label: "Cancelado", at: order.cancelled_at, status: "cancelled" });
  });
});

describe("computeTotalDurationMs", () => {
  test("pedido ativo: created_at até agora", () => {
    const order = { ...baseOrder, status: "in_preparation" };
    const now = new Date("2026-01-01T19:14:00.000Z").getTime();
    expect(computeTotalDurationMs(order, now)).toBe(10 * 60 * 1000);
  });

  test("entregue: created_at até delivered_at", () => {
    const order = { ...baseOrder, status: "delivered", delivered_at: "2026-01-01T19:24:00.000Z" };
    expect(computeTotalDurationMs(order)).toBe(20 * 60 * 1000);
  });

  test("cancelado: created_at até cancelled_at", () => {
    const order = { ...baseOrder, status: "cancelled", cancelled_at: "2026-01-01T19:15:00.000Z" };
    expect(computeTotalDurationMs(order)).toBe(11 * 60 * 1000);
  });

  test("entregue sem delivered_at: não calcula (retorna null em vez de inventar)", () => {
    const order = { ...baseOrder, status: "delivered", delivered_at: null };
    expect(computeTotalDurationMs(order)).toBeNull();
  });
});

describe("computeUntilCurrentDurationMs", () => {
  test("em preparo: created_at até updated_at", () => {
    const order = { ...baseOrder, status: "in_preparation", updated_at: "2026-01-01T19:08:00.000Z" };
    expect(computeUntilCurrentDurationMs(order)).toBe(4 * 60 * 1000);
  });

  test("pedido novo: não se aplica (retorna null, não zero)", () => {
    const order = { ...baseOrder, status: "new" };
    expect(computeUntilCurrentDurationMs(order)).toBeNull();
  });

  test("entregue: não se aplica (já coberto por 'tempo total')", () => {
    const order = { ...baseOrder, status: "delivered", updated_at: "2026-01-01T19:24:00.000Z", delivered_at: "2026-01-01T19:24:00.000Z" };
    expect(computeUntilCurrentDurationMs(order)).toBeNull();
  });
});

describe("formatDurationMinutes", () => {
  test("minutos", () => {
    expect(formatDurationMinutes(13 * 60 * 1000)).toBe("13 min");
  });

  test("horas exatas", () => {
    expect(formatDurationMinutes(2 * 60 * 60 * 1000)).toBe("2h");
  });

  test("horas e minutos", () => {
    expect(formatDurationMinutes(90 * 60 * 1000)).toBe("1h30min");
  });
});
