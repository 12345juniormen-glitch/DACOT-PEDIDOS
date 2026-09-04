import { useEffect, useState } from "react";
import { Plus, Pencil, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerFormDialog } from "@/components/CustomerFormDialog";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

export default function CustomersPage() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);

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
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-1">Cadastro simples para vincular aos pedidos.</p>
        </div>
        <Button onClick={openCreate} data-testid="new-customer-button">
          <Plus className="w-4 h-4 mr-1.5" /> Novo Cliente
        </Button>
      </header>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Nome</th>
              <th className="px-4 py-2.5 font-semibold">Telefone</th>
              <th className="px-4 py-2.5 font-semibold">Observações</th>
              <th className="px-4 py-2.5 font-semibold w-16"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan="4" className="px-4 py-12 text-center">
                <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <div className="text-sm text-muted-foreground">Nenhum cliente cadastrado.</div>
              </td></tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className="border-t" data-testid={`customer-row-${c.id}`}>
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone || "—"}</td>
                <td className="px-4 py-3 text-slate-600 line-clamp-1">{c.notes || "—"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(c)} data-testid={`edit-customer-${c.id}`} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900">
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
    </div>
  );
}
