import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { api } from "../lib/api";
import { WhatsAppMedia } from "./WhatsAppMedia";

jest.mock("../lib/api", () => ({ api: { get: jest.fn() } }));
jest.mock("./ui/button", () => ({
  Button: ({ children, variant, size, ...props }) => require("react").createElement("button", props, children),
}));

describe("WhatsAppMedia", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    URL.createObjectURL = jest.fn(() => "blob:media-teste");
    URL.revokeObjectURL = jest.fn();
    api.get.mockResolvedValue({ data: new Blob(["imagem"], { type: "image/png" }) });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  test("carrega foto pela API autenticada e limpa o endereço temporário", async () => {
    await act(async () => root.render(<WhatsAppMedia conversationId="conversa-1" message={{ id: "msg-1", type: "image", media_available: true }} />));
    expect(api.get).toHaveBeenCalledWith(
      "/whatsapp/conversations/conversa-1/messages/msg-1/media",
      expect.objectContaining({ responseType: "blob", signal: expect.anything() }),
    );
    expect(container.querySelector("img").getAttribute("src")).toBe("blob:media-teste");
    act(() => root.unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-teste");
    root = createRoot(container);
  });

  test("mídia antiga indisponível mantém a legenda sem buscar arquivo", async () => {
    await act(async () => root.render(<WhatsAppMedia conversationId="conversa-1" message={{ id: "msg-2", type: "audio", media_available: false, text: "Áudio antigo" }} />));
    expect(container.textContent).toContain("Mídia indisponível");
    expect(container.textContent).toContain("Áudio antigo");
    expect(api.get).not.toHaveBeenCalled();
  });

  test("amplia a foto ao clicar e fecha com Escape", async () => {
    await act(async () => root.render(<WhatsAppMedia conversationId="conversa-1" message={{ id: "msg-1", type: "image", media_available: true }} />));
    await act(async () => container.querySelector('[aria-label="Ampliar foto"]').click());
    expect(document.querySelector('[role="dialog"] img').alt).toBe("Foto recebida ampliada");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test("documento é carregado sob demanda", async () => {
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => root.render(<WhatsAppMedia conversationId="conversa-1" message={{ id: "msg-3", type: "document", media_available: true, file_name: "cardapio.pdf" }} />));
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button").click());
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});
