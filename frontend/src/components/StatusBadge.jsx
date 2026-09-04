import { Circle, Flame, CheckCircle2, PackageCheck, XCircle } from "lucide-react";
import { STATUS_CLASS, STATUS_LABEL } from "@/lib/format";

// Ícone por status: reforça o significado sem depender só da cor (a mesma
// forma/ícone se repete em qualquer tela que use este componente).
export const STATUS_ICON = {
  new: Circle,
  in_preparation: Flame,
  ready: CheckCircle2,
  delivered: PackageCheck,
  cancelled: XCircle,
};

export function StatusBadge({ status, className = "" }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full border ${STATUS_CLASS[status] || ""} ${className}`}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {STATUS_LABEL[status] || status}
    </span>
  );
}

/** Pill ativo/inativo padrão — usado em Produtos e Usuários (mesmo dado, mesma aparência). */
export function ActivePill({ active }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full border ${
        active
          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900"
          : "bg-muted text-muted-foreground border-border"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400 dark:bg-slate-500"}`} />
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}
