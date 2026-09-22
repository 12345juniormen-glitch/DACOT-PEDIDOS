import {
  buildTimelineEvents,
  buildAuditTimelineEvents,
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

  test("pedido legado pronto após rollback: não reconstrói o 'Pronto' anterior", () => {
    // Para pedidos sem eventos, updated_at reflete só a transição mais recente.
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

describe("buildAuditTimelineEvents", () => {
  test("preserva todas as transições, inclusive rollback", () => {
    const order = { ...baseOrder, status: "ready", updated_at: "2026-01-01T19:30:00.000Z" };
    const audit = [
      { id: "1", type: "created", new_status: "new", occurred_at: order.created_at },
      { id: "2", type: "status_changed", new_status: "in_preparation", occurred_at: "2026-01-01T19:08:00.000Z" },
      { id: "3", type: "status_changed", new_status: "ready", occurred_at: "2026-01-01T19:21:00.000Z" },
      { id: "4", type: "status_changed", new_status: "in_preparation", occurred_at: "2026-01-01T19:24:00.000Z" },
      { id: "5", type: "status_changed", new_status: "ready", occurred_at: "2026-01-01T19:30:00.000Z" },
    ];
    expect(buildAuditTimelineEvents(order, audit).map((e) => e.label)).toEqual([
      "Pedido criado", "Em preparo", "Pronto", "Em preparo", "Pronto",
    ]);
  });

  test("pedidos antigos sem eventos mantêm o fallback honesto", () => {
    const order = { ...baseOrder, status: "ready", updated_at: "2026-01-01T19:30:00.000Z" };
    expect(buildAuditTimelineEvents(order, [])).toEqual(buildTimelineEvents(order));
  });

  test("pedido legado que ganhou eventos conserva a criação conhecida", () => {
    const order = { ...baseOrder, status: "ready" };
    const audit = [{ id: "later", type: "status_changed", new_status: "ready", occurred_at: "2026-01-01T19:30:00.000Z" }];
    expect(buildAuditTimelineEvents(order, audit).map((e) => e.label)).toEqual(["Pedido criado", "Pronto"]);
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
