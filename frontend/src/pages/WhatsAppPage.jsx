import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { api, formatApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";

export default function WhatsAppPage() {
  useDocumentTitle("WhatsApp");
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedId = selected?.id;

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

  return <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto">
    <PageHeader title="WhatsApp" subtitle="Atendimento de pedidos" />
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
          <div className="flex gap-2 mt-3"><Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={selected.can_reply ? "Responder…" : "Janela encerrada; requer template aprovado"} disabled={!selected.can_reply || busy} /><Button disabled={!selected.can_reply || busy || !draft.trim()} onClick={send}>Enviar</Button></div>
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
  </div>;
}
