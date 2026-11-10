import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { VoiceMessageBubble } from "./VoiceMessageBubble";

describe("VoiceMessageBubble", () => {
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

  test("mostra duração real e permite reproduzir, pausar e buscar no áudio", async () => {
    await act(async () => root.render(<VoiceMessageBubble src="blob:audio-teste" />));
    const audio = container.querySelector("audio");
    let paused = true;
    Object.defineProperty(audio, "duration", { configurable: true, value: 125 });
    Object.defineProperty(audio, "paused", { configurable: true, get: () => paused });
    audio.play = jest.fn(async () => { paused = false; audio.dispatchEvent(new Event("play")); });
    audio.pause = jest.fn(() => { paused = true; audio.dispatchEvent(new Event("pause")); });

    await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
    expect(container.textContent).toContain("0:00 / 2:05");
    await act(async () => container.querySelector('[aria-label="Reproduzir áudio"]').click());
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="Pausar áudio"]')).not.toBeNull();

    const slider = container.querySelector('input[type="range"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, "30");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(audio.currentTime).toBe(30);
    expect(container.textContent).toContain("0:30 / 2:05");
    await act(async () => container.querySelector('[aria-label="Pausar áudio"]').click());
    expect(audio.pause).toHaveBeenCalledTimes(1);
  });

  test("mostra erro de reprodução sem alterar a mensagem", async () => {
    await act(async () => root.render(<VoiceMessageBubble src="blob:audio-teste" />));
    const audio = container.querySelector("audio");
    audio.play = jest.fn(() => Promise.reject(new Error("codec não suportado")));
    await act(async () => container.querySelector('[aria-label="Reproduzir áudio"]').click());
    expect(container.textContent).toContain("Não foi possível reproduzir este áudio.");
  });
});
