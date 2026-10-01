import {
  calculateOrderPrepEstimate,
  formatOrderPrepEstimate,
  formatPrepClock,
  parsePrepClock,
} from "./prepTime";

describe("prepTime", () => {
  test("converte o formato MM:SS", () => {
    expect(parsePrepClock("08:30")).toBe(510);
    expect(parsePrepClock("8:30")).toBe(510);
    expect(parsePrepClock("08:75")).toBeNull();
    expect(formatPrepClock(510)).toBe("08:30");
  });

  test("ignora itens instantâneos", () => {
    expect(calculateOrderPrepEstimate([{ prep_time_seconds: 0, quantity: 3 }])).toBeNull();
  });

  test("adiciona 30% por unidade extra e arredonda para cinco minutos", () => {
    const items = [
      { prep_time_seconds: 600, quantity: 2 },
      { prep_time_seconds: 480, quantity: 1 },
      { prep_time_seconds: 0, quantity: 1 },
    ];
    expect(calculateOrderPrepEstimate(items)).toEqual({ lowerMinutes: 15, upperMinutes: 20 });
    expect(formatOrderPrepEstimate(items)).toBe("15–20 min");
  });

  test("considera produtos diferentes em paralelo", () => {
    expect(formatOrderPrepEstimate([
      { prep_time_seconds: 600, quantity: 1 },
      { prep_time_seconds: 480, quantity: 1 },
    ])).toBe("10–15 min");
  });
});
