import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Cabeçalho padrão de página: título + subtítulo + ação principal opcional
 * (+ botão de voltar opcional). Usado nas telas internas para que título,
 * subtítulo e ações tenham sempre a mesma hierarquia e espaçamento.
 */
function eyebrowFor(title) {
  const normalized = String(title || "").toLocaleLowerCase("pt-BR");
  if (/histórico/.test(normalized)) return "HISTÓRICO";
  if (/dashboard|pedido|pedidos|garçom|cozinha/.test(normalized)) return "OPERAÇÃO";
  if (/cliente|produto/.test(normalized)) return "CADASTROS";
  if (/whatsapp/.test(normalized)) return "ATENDIMENTO";
  if (/usuário|perfil/.test(normalized)) return "ADMINISTRAÇÃO";
  return "MÓDULO DE PEDIDOS";
}

export function PageHeader({ title, subtitle, action, onBack, backLabel = "Voltar", testId, eyebrow }) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className={onBack ? "flex min-w-0 items-start gap-3" : "min-w-0"}>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="back-button">
            <ArrowLeft className="w-4 h-4 mr-1" /> {backLabel}
          </Button>
        )}
        <div className="min-w-0">
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="h-px w-5 shrink-0 bg-primary" />
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{eyebrow || eyebrowFor(title)}</span>
          </div>
          <h1 data-testid={testId} className="font-display text-[26px] font-medium leading-none tracking-[-0.025em] text-foreground sm:text-[30px]">
            {title}
          </h1>
          {subtitle && <p className="mt-2.5 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}
