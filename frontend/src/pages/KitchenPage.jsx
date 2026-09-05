import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ChefHat, Play, Check, Clock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, formatApiError } from "@/lib/api";
import { shouldBeepForNewOrders } from "@/lib/kitchenAlerts";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";

// KDS — visão exclusiva para cozinha.
// Mostra pedidos em `new`, `in_preparation` e `ready`.
// Ao marcar Entregue (feito por outra role), o pedido sai da lista na próxima atualização.

// Timestamp que marca a entrada no status atual. Para "new" é sempre created_at (regra do
// indicador de tempo: contar desde a criação, mesmo após um rollback). Para os demais,
// updated_at só é tocado por uma transição de status real (backend/modules/orders/routes.py),
// nunca por uma edição de conteúdo do pedido — por isso é seguro usá-lo aqui.
const STAGE_TIMESTAMP_FIELD = { new: "created_at", in_preparation: "updated_at", ready: "updated_at" };

function formatElapsedClock(elapsedMs) {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// 0–9min: normal · 10–19min: destaque leve · 20+min: destaque de atenção.
function elapsedTierClass(elapsedMs) {
  const totalMin = Math.floor(elapsedMs / 60000);
  if (totalMin >= 20) return "text-rose-600 dark:text-rose-400 font-bold";
  if (totalMin >= 10) return "text-amber-600 dark:text-amber-400 font-semibold";
  return "text-muted-foreground font-medium";
}

export default function KitchenPage() {
  useDocumentTitle("Cozinha");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // order id currently being updated
  const [now, setNow] = useState(() => Date.now());
  // null = ainda não lemos nenhum poll (primeiro load não deve soar alerta).
  const prevNewCountRef = useRef(null);
  const audioCtxRef = useRef(null);

  // Beep curto via Web Audio API — sem asset, sem dependência, sem loop. Só toca se o
  // AudioContext já estiver "running" (desbloqueado por uma interação real do usuário);
  // do contrário fica em silêncio, sem tentar contornar a política de autoplay do navegador.
  const playBeep = () => {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx || ctx.state !== "running") return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // o som é só um extra — nunca deve derrubar a tela da cozinha.
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      // Três queries paralelas usando o GET /orders existente com filtro de status.
      const [nw, ip, rd] = await Promise.all([
        api.get("/orders", { params: { status: "new" } }),
        api.get("/orders", { params: { status: "in_preparation" } }),
        api.get("/orders", { params: { status: "ready" } }),
      ]);
      const newCount = nw.data.length;
      if (shouldBeepForNewOrders(prevNewCountRef.current, newCount)) {
        playBeep();
        toast("🔔 Novo pedido chegou na cozinha!");
      }
      prevNewCountRef.current = newCount;
      setOrders([...nw.data, ...ip.data, ...rd.data]);
    } catch (e) {
      // Falha no poll: não atualiza prevNewCountRef, para o próximo poll bem-sucedido
      // comparar contra a última contagem confiável (evita falso positivo/negativo).
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Auto-refresh a cada 15s — sem WebSocket, seguro e simples.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deve rodar só na montagem; load muda a cada render
  }, []);

  useEffect(() => {
    // Desbloqueia o AudioContext numa interação real do usuário (política de autoplay dos
    // navegadores) — nunca tenta tocar antes disso. Um único listener, removido após o
    // primeiro uso ou ao desmontar, o que vier primeiro.
    const unlockAudio = () => {
      if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        audioCtxRef.current = new AudioContextClass();
      }
      audioCtxRef.current.resume?.().catch(() => {});
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    // Relógio local só para o indicador de tempo dos cards — não bate no backend,
    // roda em 1 único intervalo (não um por card) e é limpo ao desmontar.
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const grouped = useMemo(() => {
    const g = { new: [], in_preparation: [], ready: [] };
    // ordena mais antigos primeiro (FIFO para cozinha)
    [...orders]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((o) => { if (g[o.status]) g[o.status].push(o); });
    return g;
  }, [orders]);

  // Mirrors backend ALLOWED_TRANSITIONS for the subset the role kitchen pode usar
  // (backend/modules/orders/routes.py) — mesma regra de rollback do OrderDetailPage.
  const changeStatus = async (o, nextStatus, message) => {
    setBusy(o.id);
    try {
      await api.patch(`/orders/${o.id}/status`, { status: nextStatus });
      toast.success(`Pedido #${o.order_number}: ${message}`);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <ChefHat className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-foreground">Cozinha</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {grouped.new.length} novo{grouped.new.length !== 1 ? "s" : ""} · {grouped.in_preparation.length} em preparo · {grouped.ready.length} pronto{grouped.ready.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <Button variant="outline" size="lg" onClick={load} disabled={loading} data-testid="refresh-kitchen-button">
          <RefreshCw className={`w-5 h-5 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna: Novos */}
        <section data-testid="column-kitchen-new" className="bg-card border-2 border-blue-200 dark:border-blue-900 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b-2 border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-blue-900 dark:text-blue-200">Novos</h2>
              <span className="text-2xl font-display font-bold text-blue-700 dark:text-blue-400" data-testid="count-new">{grouped.new.length}</span>
            </div>
          </div>
          <div className="p-4 space-y-4 min-h-[300px] max-h-[calc(100vh-260px)] overflow-y-auto">
            {grouped.new.length === 0 && (
              <div className="text-center text-base text-muted-foreground py-16">Nenhum pedido novo</div>
            )}
            {grouped.new.map((o) => (
              <KitchenCard key={o.id} order={o} now={now}>
                <Button
                  size="lg"
                  className="w-full text-base h-12"
                  onClick={() => changeStatus(o, "in_preparation", "preparo iniciado")}
                  disabled={busy === o.id}
                  data-testid={`start-prep-${o.order_number}`}
                >
                  <Play className="w-5 h-5 mr-2" /> Iniciar preparo
                </Button>
              </KitchenCard>
            ))}
          </div>
        </section>

        {/* Coluna: Em preparo */}
        <section data-testid="column-kitchen-in-prep" className="bg-card border-2 border-orange-300 dark:border-orange-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b-2 border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-orange-900 dark:text-orange-200">Em preparo</h2>
              <span className="text-2xl font-display font-bold text-orange-700 dark:text-orange-400" data-testid="count-in-prep">{grouped.in_preparation.length}</span>
            </div>
          </div>
          <div className="p-4 space-y-4 min-h-[300px] max-h-[calc(100vh-260px)] overflow-y-auto">
            {grouped.in_preparation.length === 0 && (
              <div className="text-center text-base text-muted-foreground py-16">Nenhum pedido em preparo</div>
            )}
            {grouped.in_preparation.map((o) => (
              <KitchenCard key={o.id} order={o} now={now} accent="orange">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    className="flex-1 text-sm h-12"
                    onClick={() => changeStatus(o, "new", "voltou para Novo")}
                    disabled={busy === o.id}
                    data-testid={`revert-to-new-${o.order_number}`}
                  >
                    <RotateCcw className="w-4 h-4 mr-1.5" /> Voltar para Novo
                  </Button>
                  <Button
                    size="lg"
                    className="flex-[2] text-base h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => changeStatus(o, "ready", "pronto para retirada")}
                    disabled={busy === o.id}
                    data-testid={`mark-ready-${o.order_number}`}
                  >
                    <Check className="w-5 h-5 mr-2" /> Marcar como pronto
                  </Button>
                </div>
              </KitchenCard>
            ))}
          </div>
        </section>

        {/* Coluna: Prontos */}
        <section data-testid="column-kitchen-ready" className="bg-card border-2 border-emerald-300 dark:border-emerald-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-emerald-900 dark:text-emerald-200">Prontos</h2>
              <span className="text-2xl font-display font-bold text-emerald-700 dark:text-emerald-400" data-testid="count-ready">{grouped.ready.length}</span>
            </div>
          </div>
          <div className="p-4 space-y-4 min-h-[300px] max-h-[calc(100vh-260px)] overflow-y-auto">
            {grouped.ready.length === 0 && (
              <div className="text-center text-base text-muted-foreground py-16">Nenhum pedido pronto</div>
            )}
            {grouped.ready.map((o) => (
              <KitchenCard key={o.id} order={o} now={now} accent="emerald">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full text-sm h-12"
                  onClick={() => changeStatus(o, "in_preparation", "voltou para Em preparo")}
                  disabled={busy === o.id}
                  data-testid={`revert-to-in-preparation-${o.order_number}`}
                >
                  <RotateCcw className="w-4 h-4 mr-1.5" /> Voltar para Em preparo
                </Button>
              </KitchenCard>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function KitchenCard({ order, now, accent = "blue", children }) {
  const accentBorder = accent === "orange"
    ? "border-orange-200 dark:border-orange-900"
    : accent === "emerald"
      ? "border-emerald-200 dark:border-emerald-900"
      : "border-slate-200 dark:border-slate-700";
  const stageTimestamp = order[STAGE_TIMESTAMP_FIELD[order.status]] || order.created_at;
  const elapsedMs = now - new Date(stageTimestamp).getTime();
  return (
    <article
      data-testid={`kitchen-order-${order.order_number}`}
      className={`border rounded-lg overflow-hidden bg-card shadow-sm ${accentBorder}`}
    >
      <header className="px-4 py-3 flex items-center justify-between bg-muted border-b">
        <div className="font-display font-bold text-2xl text-foreground">#{order.order_number}</div>
        <div className="flex items-center gap-1.5 text-sm" data-testid={`elapsed-${order.order_number}`}>
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className={`font-display tabular-nums ${elapsedTierClass(elapsedMs)}`}>{formatElapsedClock(elapsedMs)}</span>
        </div>
      </header>
      <div className="p-4 space-y-2">
        <ul className="space-y-2" data-testid={`items-${order.order_number}`}>
          {order.items.map((i, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="inline-flex items-center justify-center min-w-[2.5rem] h-9 px-2 rounded bg-slate-900 text-white font-display font-bold text-base">
                {i.quantity}×
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-base text-foreground leading-tight">{i.product_name}</div>
                {i.notes && (
                  <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-950 dark:border-amber-900 rounded px-2 py-1 mt-1 inline-block">
                    ⚑ {i.notes}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {order.notes && (
          <div className="mt-3 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900 dark:bg-amber-950 dark:border-amber-900 dark:text-amber-200">
            <span className="font-semibold">Obs. do pedido: </span>{order.notes}
          </div>
        )}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </article>
  );
}
