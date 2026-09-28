import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PageHeader } from "@/components/PageHeader";
import { api, formatApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/context/AuthContext";
import { Settings } from "lucide-react";
import { toast } from "sonner";

const AUTO_MESSAGE_LABELS = {
  received: "Pedido recebido",
  in_preparation: "Em preparo",
  ready: "Pronto",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export default function WhatsAppPage() {
  useDocumentTitle("WhatsApp");
  const navigate = useNavigate();
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoMessages, setAutoMessages] = useState(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [connection, setConnection] = useState({ state: "loading", connected: false, qr_data_url: null });
  const selectedId = selected?.id;
  const canManageConnection = ["admin", "manager"].includes(user?.role);

  useEffect(() => {
    if (!canManageConnection) return;
    let active = true;
    api.get("/whatsapp/auto-messages")
      .then(({ data }) => { if (active) setAutoMessages(data); })
      .catch((e) => { if (active) toast.error(formatApiError(e)); });
    return () => { active = false; };
  }, [canManageConnection]);

  const loadConnection = useCallback(async (quiet = true) => {
    try {
      const { data } = await api.get("/whatsapp/config");
      setConnection(data);
    } catch (e) {
      setConnection({ state: "unavailable", connected: false, qr_data_url: null });
      if (!quiet) toast.error(formatApiError(e));
    }
  }, []);

  useEffect(() => {
    loadConnection(false);
    const timer = setInterval(() => loadConnection(true), 3000);
    return () => clearInterval(timer);
  }, [loadConnection]);

  useEffect(() => {
    let active = true;
    const load = () => api.get("/whatsapp/conversations")
      .then(({ data }) => { if (active) { setConversations(data); setSelected((old) => old ? data.find((item) => item.id === old.id) || null : null); } })
      .catch((e) => { if (active) toast.error(formatApiError(e)); });
    load();
    const timer = setInterval(load, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    let active = true;
    const load = () => api.get(`/whatsapp/conversations/${selectedId}/messages`, { params: { page } })
      .then(({ data }) => { if (active) { setMessages(data.items); setPages(data.pages); } })
      .catch((e) => { if (active) toast.error(formatApiError(e)); });
    load();
    api.post(`/whatsapp/conversations/${selectedId}/read`).catch(() => {});
    const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [selectedId, page]);

  const send = async () => {
    if (!draft.trim() || !selected) return;
    setBusy(true);
    try {
      await api.post(`/whatsapp/conversations/${selected.id}/messages`, { text: draft.trim() });
      setDraft("");
      const { data } = await api.get(`/whatsapp/conversations/${selected.id}/messages`, { params: { page: 1 } });
      setPage(1); setMessages(data.items); setPages(data.pages);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const createCustomer = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/whatsapp/conversations/${selected.id}/customer`, {
        name: selected.profile_name || selected.phone,
      });
      setSelected({ ...selected, customer_id: data.customer_id });
      setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, customer_id: data.customer_id } : item));
      toast.success("Cliente vinculado");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const setConsent = async (allowed) => {
    try {
      await api.post(`/whatsapp/conversations/${selected.id}/order-updates-consent`, { allowed });
      setSelected({ ...selected, order_updates_opt_in: allowed });
      setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, order_updates_opt_in: allowed } : item));
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/whatsapp/connect");
      setConnection(data);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Desconectar este WhatsApp do restaurante? Será necessário ler um novo QR Code para reconectar.")) return;
    setBusy(true);
    try {
      const { data } = await api.delete("/whatsapp/connection");
      setConnection(data);
      toast.success("WhatsApp desconectado");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const updateAutoMessage = (status, changes) => {
    setAutoMessages((current) => ({
      ...current,
      [status]: { ...current[status], ...changes },
    }));
  };

  const saveAutoMessages = async () => {
    setSettingsBusy(true);
    try {
      const { data } = await api.put("/whatsapp/auto-messages", autoMessages);
      setAutoMessages(data);
      toast.success("Mensagens automáticas salvas");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSettingsBusy(false); }
  };

  const connectionLabel = {
    loading: "Verificando", connecting: "Conectando", waiting_qr: "Aguardando QR",
    reconnecting: "Reconectando", connected: "Conectado", disconnected: "Desconectado",
    unavailable: "Indisponível",
  }[connection.state] || "Desconectado";

  return <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto">
    <PageHeader title="WhatsApp" subtitle="Atendimento de pedidos" />
    <section className="rounded-lg border bg-card p-4 mb-3 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold">Conexão do restaurante</h2>
          <Badge variant={connection.connected ? "default" : "outline"}>{connectionLabel}</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {connection.connected
            ? `WhatsApp vinculado${connection.phone ? ` · ${connection.phone}` : ""}`
            : connection.state === "waiting_qr" ? "Abra Aparelhos conectados no WhatsApp e leia o código abaixo." : "Conecte um WhatsApp para receber e responder mensagens."}
        </p>
      </div>
      {canManageConnection && <div className="flex gap-2 shrink-0">
        {!connection.connected && connection.state !== "waiting_qr" && connection.state !== "connecting" &&
          <Button onClick={connect} disabled={busy}>Conectar WhatsApp</Button>}
        {(connection.connected || connection.state === "waiting_qr" || connection.state === "connecting" || connection.state === "reconnecting") &&
          <Button variant="outline" onClick={disconnect} disabled={busy}>Desconectar</Button>}
      </div>}
    </section>
    {canManageConnection && connection.state === "waiting_qr" && connection.qr_data_url &&
      <section className="rounded-lg border bg-card p-4 mb-3 text-center">
        <img src={connection.qr_data_url} alt="QR Code para conectar o WhatsApp" className="w-64 h-64 max-w-full mx-auto rounded-md bg-white p-2" />
        <p className="text-xs text-muted-foreground mt-2">O código é temporário e será renovado automaticamente.</p>
      </section>}
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_240px] gap-3">
      <section className="rounded-lg border bg-card p-3 max-h-[70vh] overflow-y-auto">
        <h2 className="font-semibold mb-2">Conversas</h2>
        {conversations.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conversa recebida.</p>}
        {conversations.map((item) => <button key={item.id} onClick={() => { setSelected(item); setPage(1); }}
          className={`w-full text-left rounded-md p-3 mb-1 hover:bg-muted ${selected?.id === item.id ? "bg-muted" : ""}`}>
          <span className="font-medium block truncate">{item.profile_name || item.phone}</span>
          <span className="text-xs text-muted-foreground">{item.phone}</span>
          {item.unread > 0 && <span className="ml-2 text-xs text-primary font-semibold">{item.unread} nova{item.unread !== 1 ? "s" : ""}</span>}
        </button>)}
      </section>
      <section className="rounded-lg border bg-card p-3 sm:p-4 min-h-[350px] flex flex-col min-w-0">
        <h2 className="font-semibold mb-2">Mensagens</h2>
        {!selected ? <p className="text-sm text-muted-foreground">Selecione uma conversa.</p> : <>
          {pages > 1 && <div className="flex gap-2 items-center text-xs mb-2"><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Mais antigas</Button><span>Página {page} de {pages}</span><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Mais recentes</Button></div>}
          <div className="flex-1 space-y-2 overflow-y-auto max-h-[55vh]">
            {messages.map((message) => <div key={message.id} className={`rounded-md p-2 text-sm max-w-[90%] break-words ${message.direction === "outbound" ? "ml-auto bg-primary/10" : "bg-muted"}`}>
              <div>{message.type === "text" ? message.text : "Mensagem não suportada nesta versão"}</div>
              <div className="text-[11px] text-muted-foreground mt-1">{formatDateTime(message.created_at)} · {message.status}</div>
            </div>)}
          </div>
          <div className="flex gap-2 mt-3"><Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={connection.connected ? "Responder…" : "Conecte o WhatsApp para responder"} disabled={!connection.connected || busy} /><Button disabled={!connection.connected || busy || !draft.trim()} onClick={send}>Enviar</Button></div>
        </>}
      </section>
      <section className="rounded-lg border bg-card p-3 sm:p-4 h-fit">
        <h2 className="font-semibold mb-2">Cliente</h2>
        {selected ? <><p className="text-sm break-words">{selected.profile_name || selected.phone}<br /><span className="text-muted-foreground">{selected.phone}</span></p>
          <label className="flex items-start gap-2 text-xs mt-4 text-muted-foreground"><input type="checkbox" className="mt-0.5" checked={!!selected.order_updates_opt_in} onChange={(e) => setConsent(e.target.checked)} /><span>Cliente autorizou receber atualizações do pedido por WhatsApp</span></label>
          {selected.customer_id ? <Button className="w-full mt-4" onClick={() => navigate(`/pedidos/novo?customer=${encodeURIComponent(selected.customer_id)}`)}>Criar pedido</Button>
            : <Button className="w-full mt-4" variant="outline" disabled={busy} onClick={createCustomer}>Criar/vincular cliente</Button>}
        </> : <p className="text-sm text-muted-foreground">Sem conversa selecionada.</p>}
      </section>
    </div>
    {canManageConnection && autoMessages && <Accordion type="single" collapsible className="mt-3 rounded-lg border bg-card px-4">
      <AccordionItem value="auto-messages" className="border-b-0">
        <AccordionTrigger className="py-4 hover:no-underline">
          <div className="flex items-start gap-3 min-w-0 pr-3">
            <Settings className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-semibold text-sm sm:text-base">Configurações de mensagens automáticas</div>
              <div className="text-xs sm:text-sm font-normal text-muted-foreground mt-0.5">
                Personalize os avisos enviados quando o pedido muda de status.
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4 pt-1">
            <div>
              <p className="text-sm text-muted-foreground">
                Os avisos são enviados somente aos clientes que autorizaram atualizações.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Variáveis disponíveis: {"{{cliente}}"}, {"{{pedido}}"} e {"{{restaurante}}"}.
              </p>
            </div>
            <Button className="shrink-0 w-full sm:w-auto" onClick={saveAutoMessages} disabled={settingsBusy}>
              {settingsBusy ? "Salvando…" : "Salvar mensagens"}
            </Button>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {Object.entries(AUTO_MESSAGE_LABELS).map(([status, label]) => <div key={status} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <label htmlFor={`auto-message-${status}`} className="font-medium text-sm">{label}</label>
                <Switch id={`auto-message-${status}`} checked={autoMessages[status].enabled}
                  onCheckedChange={(enabled) => updateAutoMessage(status, { enabled })}
                  aria-label={`Ativar mensagem automática: ${label}`} />
              </div>
              <Textarea rows={3} value={autoMessages[status].message}
                onChange={(event) => updateAutoMessage(status, { message: event.target.value })}
                disabled={!autoMessages[status].enabled} maxLength={1000}
                aria-label={`Mensagem automática: ${label}`} />
            </div>)}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>}
  </div>;
}
