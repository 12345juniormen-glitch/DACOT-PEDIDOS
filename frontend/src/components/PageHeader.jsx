import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Cabeçalho padrão de página: título + subtítulo + ação principal opcional
 * (+ botão de voltar opcional). Usado nas telas internas para que título,
 * subtítulo e ações tenham sempre a mesma hierarquia e espaçamento.
 */
export function PageHeader({ title, subtitle, action, onBack, backLabel = "Voltar", testId }) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div className={onBack ? "flex items-center gap-3" : undefined}>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="back-button">
            <ArrowLeft className="w-4 h-4 mr-1" /> {backLabel}
          </Button>
        )}
        <div>
          <h1 data-testid={testId} className="text-xl sm:text-2xl font-display font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex flex-wrap gap-2 shrink-0">{action}</div>}
    </header>
  );
}
