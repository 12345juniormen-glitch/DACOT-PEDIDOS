import { useEffect, useState } from "react";
import { Plus, Pencil, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerFormDialog } from "@/components/CustomerFormDialog";
import { CustomerDetailDialog } from "@/components/CustomerDetailDialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { api, formatApiError } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";

export default function CustomersPage() {
  useDocumentTitle("Clientes");
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/customers");
      setItems(data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setOpen(true); };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Clientes"
        subtitle="Cadastro para vincular aos pedidos"
        action={
          <Button onClick={openCreate} data-testid="new-customer-button">
            <Plus className="w-4 h-4 mr-1.5" /> Novo Cliente
          </Button>
        }
      />

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Nome</th>
              <th className="px-4 py-2.5 font-semibold">Telefone</th>
              <th className="px-4 py-2.5 font-semibold">Observações</th>
              <th className="px-4 py-2.5 font-semibold w-16"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan="4">
                <EmptyState
                  icon={Users}
                  title="Nenhum cliente cadastrado"
                  description="Clientes cadastrados aqui ficam disponíveis ao criar um pedido."
                  action={<Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" /> Novo Cliente</Button>}
                />
              </td></tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className="border-t" data-testid={`customer-row-${c.id}`}>
                <td className="px-4 py-3 font-medium">
                  <button
                    onClick={() => setViewing(c)}
                    data-testid={`view-customer-${c.id}`}
                    className="text-left hover:text-primary hover:underline"
                  >
                    {c.name}
                  </button>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.phone || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground line-clamp-1">{c.notes || "—"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(c)} data-testid={`edit-customer-${c.id}`} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Pencil className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <CustomerFormDialog open={open} onOpenChange={setOpen} editing={editing} onSaved={load} />
      <CustomerDetailDialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)} customer={viewing} />
    </div>
  );
}
