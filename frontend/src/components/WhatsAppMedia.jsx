import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { api } from "../lib/api";

export function WhatsAppMedia({ conversationId, message }) {
  const holder = useRef(null);
  const objectUrl = useRef(null);
  const pending = useRef(null);
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const endpoint = `/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(message.id)}/media`;

  const download = (fileUrl = url) => {
    if (!fileUrl) return;
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = (message.file_name || "documento").replace(/[<>:"/\\|?*]/g, "_");
    link.click();
  };

  const load = async () => {
    if (pending.current || objectUrl.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(false);
    try {
      const { data } = await api.get(endpoint, { responseType: "blob", signal: controller.signal });
      if (!controller.signal.aborted) {
        objectUrl.current = URL.createObjectURL(data);
        setUrl(objectUrl.current);
        if (message.type === "document") download(objectUrl.current);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (message.type !== "image" || !message.media_available) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      load();
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        observer.disconnect();
        load();
      }
    });
    observer.observe(holder.current);
    return () => observer.disconnect();
  // The message identity is stable for the lifetime of this keyed component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, message.type, message.media_available]);

  useEffect(() => () => {
    pending.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  if (!message.media_available) return <div>
    <span className="text-muted-foreground">Mídia indisponível. Peça para reenviar.</span>
    {message.text && <p className="mt-1 whitespace-pre-wrap">{message.text}</p>}
  </div>;

  return <div ref={holder} className="min-w-0">
    {url && message.type === "image" && <img src={url} alt="Foto recebida" className="max-h-80 max-w-full object-contain" />}
    {url && message.type === "audio" && <audio controls src={url} className="max-w-full" aria-label="Áudio recebido" />}
    {url && message.type === "video" && <video controls src={url} className="max-h-96 max-w-full" aria-label="Vídeo recebido" />}
    {message.type === "document" && <div className="break-all">{message.file_name || "Documento"}</div>}
    {message.type === "document" && url && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => download()}>Baixar documento</Button>}
    {!url && message.type !== "image" && <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
      {loading ? "Carregando…" : message.type === "document" ? "Baixar documento" : message.type === "audio" ? "Reproduzir áudio" : "Ver vídeo"}
    </Button>}
    {loading && message.type === "image" && <span className="text-muted-foreground">Carregando foto…</span>}
    {error && <Button type="button" variant="ghost" size="sm" onClick={load}>Falha ao carregar. Tentar novamente</Button>}
    {message.text && <p className="mt-1 whitespace-pre-wrap">{message.text}</p>}
  </div>;
}
