import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { VoiceMessageBubble } from "./VoiceMessageBubble";
import { api } from "../lib/api";

export function WhatsAppMedia({ conversationId, message }) {
  const holder = useRef(null);
  const objectUrl = useRef(null);
  const pending = useRef(null);
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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
    {url && message.type === "image" && <>
      <button type="button" aria-label="Ampliar foto" onClick={() => setPreviewOpen(true)} className="block max-w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <img src={url} alt="Foto recebida" className="max-h-80 max-w-full object-contain" />
      </button>
      <DialogPrimitive.Root open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 outline-none">
            <DialogPrimitive.Title className="sr-only">Foto ampliada</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Visualização ampliada da foto recebida</DialogPrimitive.Description>
            <img src={url} alt="Foto recebida ampliada" className="max-h-[85dvh] max-w-[calc(100vw-2rem)] object-contain" />
            <DialogPrimitive.Close asChild>
              <button type="button" aria-label="Fechar foto ampliada" className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-sm bg-background/90 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>}
    {url && message.type === "audio" && <VoiceMessageBubble src={url} />}
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
