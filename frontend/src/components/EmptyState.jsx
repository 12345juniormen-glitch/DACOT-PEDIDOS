/**
 * Estado vazio padrão: ícone + mensagem + ação opcional. Usado em tabelas
 * (dentro de uma linha com colSpan) e em listas/colunas simples.
 */
export function EmptyState({ icon: Icon, title, description, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-12"}`}>
      {Icon && <Icon className="w-8 h-8 text-slate-300 mb-2" />}
      <div className="text-sm font-medium text-slate-600">{title}</div>
      {description && <div className="text-sm text-muted-foreground mt-0.5 max-w-xs">{description}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
