import { shouldBeepForNewOrders } from "../lib/kitchenAlerts";

describe("shouldBeepForNewOrders", () => {
  test("primeiro carregamento (prevCount null) nunca alerta", () => {
    expect(shouldBeepForNewOrders(null, 0)).toBe(false);
    expect(shouldBeepForNewOrders(null, 2)).toBe(false);
  });

  test("mesma quantidade não alerta", () => {
    expect(shouldBeepForNewOrders(2, 2)).toBe(false);
    expect(shouldBeepForNewOrders(0, 0)).toBe(false);
  });

  test("quantidade menor (pedido saiu de novo) não alerta", () => {
    expect(shouldBeepForNewOrders(3, 2)).toBe(false);
  });

  test("aumento de 1 pedido novo alerta", () => {
    expect(shouldBeepForNewOrders(2, 3)).toBe(true);
  });

  test("aumento de vários pedidos no mesmo poll ainda é um único alerta (booleano)", () => {
    // A função só diz "sim/não" para o poll inteiro — quem chama decide tocar
    // o beep uma vez só, independente de quantos pedidos entraram de uma vez.
    expect(shouldBeepForNewOrders(2, 7)).toBe(true);
  });
});
