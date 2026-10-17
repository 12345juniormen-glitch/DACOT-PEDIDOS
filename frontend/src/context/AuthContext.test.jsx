import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatApiError: jest.fn(() => "Handoff inválido"),
  getToken: jest.fn(),
  setToken: jest.fn(),
}));

import { api, formatApiError, getToken, setToken } from "../lib/api";
import { AuthProvider, useAuth } from "./AuthContext";

function Harness() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="bootstrap">{auth.bootstrapState}</span>
      <span data-testid="user">{auth.user ? auth.user.id : String(auth.user)}</span>
      <span data-testid="error">{auth.handoffError}</span>
      <span data-testid="access-ended">{auth.accessEndedMessage}</span>
      <button type="button" onClick={auth.completeHandoffEntry}>concluir entrada</button>
      <button type="button" onClick={() => auth.login("admin@dacot.local", "senha")}>login direto</button>
      <button type="button" onClick={() => auth.refresh({ showAccessEndedMessage: true })}>revalidar acesso</button>
    </div>
  );
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("bootstrap de autenticação e handoff", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", "/");
    sessionStorage.removeItem("dacot.access-ended");
    jest.clearAllMocks();
    formatApiError.mockReturnValue("Handoff inválido");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("handoff válido é trocado uma vez e aguarda a animação", async () => {
    window.history.replaceState({}, "", "/?handoff=token-hub");
    api.post.mockResolvedValueOnce({ data: { token: "sessao-local", user: { id: "hub-user" } } });

    await act(async () => {
      root.render(<StrictMode><AuthProvider><Harness /></AuthProvider></StrictMode>);
    });
    await flushAsync();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/orders/session/exchange", { handoff: "token-hub" });
    expect(setToken).toHaveBeenCalledWith("sessao-local");
    expect(container.querySelector("[data-testid='bootstrap']").textContent).toBe("handoff_confirmed");
    expect(container.querySelector("[data-testid='user']").textContent).toBe("hub-user");
    expect(window.location.search).toBe("");
  });

  test("handoff inválido termina em erro sem habilitar a animação", async () => {
    window.history.replaceState({}, "", "/?handoff=invalido");
    api.post.mockRejectedValueOnce({ response: { status: 401 } });

    await act(async () => root.render(<AuthProvider><Harness /></AuthProvider>));
    await flushAsync();

    expect(container.querySelector("[data-testid='bootstrap']").textContent).toBe("handoff_error");
    expect(container.querySelector("[data-testid='user']").textContent).toBe("false");
    expect(container.querySelector("[data-testid='error']").textContent).toBe("Handoff inválido");
  });

  test("restauração de sessão não é tratada como uma nova entrada pelo Hub", async () => {
    getToken.mockReturnValue("sessao-existente");
    api.get.mockResolvedValueOnce({ data: { id: "existing-user" } });

    await act(async () => root.render(<AuthProvider><Harness /></AuthProvider>));
    await flushAsync();

    expect(api.post).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith("/auth/me");
    expect(container.querySelector("[data-testid='bootstrap']").textContent).toBe("ready");
    expect(container.querySelector("[data-testid='user']").textContent).toBe("existing-user");
  });

  test("login direto continua autenticando sem marcar entrada por handoff", async () => {
    getToken.mockReturnValue(null);
    api.post.mockResolvedValueOnce({ data: { token: "login-token", user: { id: "login-user" } } });

    await act(async () => root.render(<AuthProvider><Harness /></AuthProvider>));
    await flushAsync();
    await act(async () => container.querySelectorAll("button")[1].click());
    await flushAsync();

    expect(api.post).toHaveBeenCalledWith("/auth/login", {
      email: "admin@dacot.local",
      password: "senha",
    });
    expect(container.querySelector("[data-testid='bootstrap']").textContent).toBe("ready");
    expect(container.querySelector("[data-testid='user']").textContent).toBe("login-user");
  });

  test("concluir a animação revela a aplicação ao finalizar o estado de handoff", async () => {
    window.history.replaceState({}, "", "/?handoff=token-hub");
    api.post.mockResolvedValueOnce({ data: { token: "sessao-local", user: { id: "hub-user" } } });

    await act(async () => root.render(<AuthProvider><Harness /></AuthProvider>));
    await flushAsync();
    expect(container.querySelector("[data-testid='bootstrap']").textContent).toBe("handoff_confirmed");

    act(() => container.querySelectorAll("button")[0].click());

    expect(container.querySelector("[data-testid='bootstrap']").textContent).toBe("ready");
  });

  test("revogação retornada pelo Hub encerra a sessão local com mensagem", async () => {
    getToken.mockReturnValue("sessao-existente");
    api.get
      .mockResolvedValueOnce({ data: { id: "existing-user" } })
      .mockRejectedValueOnce({ response: { status: 403 } });

    await act(async () => root.render(<AuthProvider><Harness /></AuthProvider>));
    await flushAsync();
    await act(async () => container.querySelectorAll("button")[2].click());
    await flushAsync();

    expect(setToken).toHaveBeenLastCalledWith(null);
    expect(container.querySelector("[data-testid='user']").textContent).toBe("false");
    expect(container.querySelector("[data-testid='access-ended']").textContent)
      .toBe("Seu acesso ao DACOT foi encerrado.");
  });

  test("mensagem de acesso encerrado sobrevive ao redirecionamento sem guardar credenciais", async () => {
    sessionStorage.setItem("dacot.access-ended", "1");
    getToken.mockReturnValue(null);

    await act(async () => root.render(<StrictMode><AuthProvider><Harness /></AuthProvider></StrictMode>));
    await flushAsync();

    expect(container.querySelector("[data-testid='access-ended']").textContent)
      .toBe("Seu acesso ao DACOT foi encerrado.");
    expect(sessionStorage.getItem("dacot.access-ended")).toBeNull();
  });
});
