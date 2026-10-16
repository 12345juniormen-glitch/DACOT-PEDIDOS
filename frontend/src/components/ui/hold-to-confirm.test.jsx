import { act } from "react";
import { createRoot } from "react-dom/client";
import { HoldToConfirm } from "./hold-to-confirm";

describe("HoldToConfirm", () => {
  let container;
  let root;
  let now;
  let frame;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    now = 0;
    frame = null;
    jest.spyOn(performance, "now").mockImplementation(() => now);
    global.requestAnimationFrame = jest.fn((callback) => {
      frame = callback;
      return 1;
    });
    global.cancelAnimationFrame = jest.fn(() => { frame = null; });
    window.matchMedia = jest.fn(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.restoreAllMocks();
  });

  const pointerEvent = (type) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 });
    Object.defineProperties(event, {
      pointerType: { value: "mouse" },
      pointerId: { value: 1 },
    });
    return event;
  };

  test("soltar antes do tempo cancela sem confirmar", () => {
    const onConfirm = jest.fn();
    act(() => root.render(<HoldToConfirm onConfirm={onConfirm}>Segure para excluir</HoldToConfirm>));
    const button = container.querySelector("button");

    act(() => button.dispatchEvent(pointerEvent("pointerdown")));
    now = 900;
    act(() => frame(now));
    act(() => button.dispatchEvent(pointerEvent("pointerup")));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.textContent).toContain("Segure para excluir");
  });

  test("manter pressionado por 1,8 segundo confirma apenas uma vez", () => {
    const onConfirm = jest.fn();
    act(() => root.render(<HoldToConfirm onConfirm={onConfirm}>Segure para excluir</HoldToConfirm>));
    const button = container.querySelector("button");

    act(() => button.dispatchEvent(pointerEvent("pointerdown")));
    now = 1801;
    act(() => frame(now));
    act(() => button.dispatchEvent(pointerEvent("pointerup")));
    act(() => button.dispatchEvent(pointerEvent("pointerdown")));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("teclado também exige manter a tecla pressionada", () => {
    const onConfirm = jest.fn();
    act(() => root.render(<HoldToConfirm onConfirm={onConfirm}>Segure para excluir</HoldToConfirm>));
    const button = container.querySelector("button");

    act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    now = 1801;
    act(() => frame(now));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
