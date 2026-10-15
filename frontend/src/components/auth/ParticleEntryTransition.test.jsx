import { act } from "react";
import { createRoot } from "react-dom/client";
import { useParticleEntryTransition } from "./ParticleEntryTransition";

function Harness({ onComplete }) {
  const { animationState, startTransition, finishTransition } = useParticleEntryTransition(onComplete);
  return (
    <div>
      <span data-testid="state">{animationState}</span>
      <button type="button" onClick={startTransition}>iniciar</button>
      <button type="button" onClick={finishTransition}>concluir</button>
    </div>
  );
}

describe("transição de entrada compartilhada", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
  });

  test("mantém DACOT formado pelo tempo mínimo antes de explodir", () => {
    act(() => root.render(<Harness onComplete={jest.fn()} />));
    const [start] = container.querySelectorAll("button");

    act(() => start.click());
    expect(container.querySelector("[data-testid='state']").textContent).toBe("loading");

    act(() => jest.advanceTimersByTime(599));
    expect(container.querySelector("[data-testid='state']").textContent).toBe("loading");

    act(() => jest.advanceTimersByTime(1));
    expect(container.querySelector("[data-testid='state']").textContent).toBe("explode");
  });

  test("conclui uma única vez mesmo com callback visual e fallback", () => {
    const onComplete = jest.fn();
    act(() => root.render(<Harness onComplete={onComplete} />));
    const [start, finish] = container.querySelectorAll("button");

    act(() => start.click());
    act(() => jest.advanceTimersByTime(600));
    act(() => finish.click());
    act(() => jest.advanceTimersByTime(800));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
