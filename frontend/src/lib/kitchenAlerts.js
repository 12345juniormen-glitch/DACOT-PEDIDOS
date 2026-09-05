// Decide se um poll deve soar o alerta de "pedido novo": só quando a contagem de `new`
// aumentou em relação ao poll anterior. `prevCount` null/undefined = ainda não temos uma
// leitura anterior (primeiro carregamento) — nesse caso nunca alerta, só registra.
// Sem dependências: usada pelo KitchenPage.jsx e testável isoladamente (KitchenPage.test.js).
export function shouldBeepForNewOrders(prevCount, nextCount) {
  if (prevCount === null || prevCount === undefined) return false;
  return nextCount > prevCount;
}
