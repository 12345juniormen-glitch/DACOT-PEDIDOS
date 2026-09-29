import { effectivePermissions, hasAnyPermission, hasPermission } from "./permissions";

describe("permissões efetivas", () => {
  test("usa o preset da role para usuários antigos sem permissions", () => {
    expect(hasPermission({ role: "waiter" }, "orders.create")).toBe(true);
    expect(hasPermission({ role: "waiter" }, "service.view")).toBe(true);
    expect(hasPermission({ role: "waiter" }, "users.manage")).toBe(false);
  });

  test("uma lista personalizada, inclusive vazia, substitui o preset", () => {
    expect(effectivePermissions({ role: "admin", permissions: [] })).toEqual([]);
    expect(hasPermission({ role: "kitchen", permissions: ["products.view"] }, "products.view")).toBe(true);
    expect(hasPermission({ role: "kitchen", permissions: ["products.view"] }, "kds.view")).toBe(false);
  });

  test("verifica alternativas sem conceder permissões implícitas", () => {
    const user = { role: "kitchen", permissions: ["kds.view"] };
    expect(hasAnyPermission(user, ["orders.create", "kds.view"])).toBe(true);
    expect(hasAnyPermission(user, ["orders.create", "users.manage"])).toBe(false);
  });
});
