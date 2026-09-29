import { groupWaiterOrders, waiterElapsedMinutes } from "./waiterOrders";

test("separa somente pedidos ativos e destaca os prontos", () => {
  const orders = [
    { id: "ready", status: "ready", created_at: "2026-01-01T10:02:00Z" },
    { id: "new", status: "new", created_at: "2026-01-01T10:00:00Z" },
    { id: "preparing", status: "in_preparation", created_at: "2026-01-01T10:01:00Z" },
    { id: "done", status: "delivered", created_at: "2026-01-01T09:00:00Z" },
  ];
  const grouped = groupWaiterOrders(orders);
  expect(grouped.inProgress.map((order) => order.id)).toEqual(["new", "preparing"]);
  expect(grouped.ready.map((order) => order.id)).toEqual(["ready"]);
});

test("usa o timestamp do estágio atual para exibir minutos", () => {
  const now = new Date("2026-01-01T10:10:00Z").getTime();
  expect(waiterElapsedMinutes({ status: "new", created_at: "2026-01-01T10:02:00Z" }, now)).toBe(8);
  expect(waiterElapsedMinutes({ status: "ready", created_at: "2026-01-01T09:00:00Z", updated_at: "2026-01-01T10:06:00Z" }, now)).toBe(4);
});
