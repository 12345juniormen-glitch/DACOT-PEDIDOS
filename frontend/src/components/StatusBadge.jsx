import { STATUS_CLASS, STATUS_LABEL } from "@/lib/format";

export function StatusBadge({ status, className = "" }) {
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${STATUS_CLASS[status] || ""} ${className}`}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}
