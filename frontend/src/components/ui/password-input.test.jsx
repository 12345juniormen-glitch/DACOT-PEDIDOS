import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("./input", () => {
  const React = require("react");
  return {
    Input: React.forwardRef((props, ref) => <input ref={ref} {...props} />),
  };
});

import { PasswordInput } from "./password-input";

describe("PasswordInput", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("começa oculto e alterna visibilidade sem submeter formulário", () => {
    act(() => root.render(<PasswordInput data-testid="password" />));

    const input = container.querySelector("input");
    const toggle = container.querySelector("button");
    expect(input.type).toBe("password");
    expect(toggle.type).toBe("button");
    expect(toggle.getAttribute("aria-label")).toBe("Mostrar senha");

    act(() => toggle.click());
    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-label")).toBe("Ocultar senha");

    act(() => toggle.click());
    expect(input.type).toBe("password");
  });

  test("cada campo controla sua própria visibilidade", () => {
    act(() => root.render(<><PasswordInput /><PasswordInput /></>));
    const inputs = container.querySelectorAll("input");
    const toggles = container.querySelectorAll("button");

    act(() => toggles[0].click());

    expect(inputs[0].type).toBe("text");
    expect(inputs[1].type).toBe("password");
  });
});
