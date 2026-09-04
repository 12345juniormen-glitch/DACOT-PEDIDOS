import { useEffect, useState } from "react";
import { Plus, Pencil, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api, formatApiError } from "@/lib/api";
import { brl } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";

const empty = { name: "", description: "", price: "", category: "Geral", active: true };

export default function ProductsPage() {
  useDocumentTitle("Produtos");
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/products");
      setProducts(data);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  };
  const openEdit = (p) => {
    setEditing(p);
    setForm({ name: p.name, description: p.description || "", price: String(p.price), category: p.category, active: p.active });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Nome obrigatório");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price) || 0,
        category: form.category.trim() || "Geral",
        active: form.active,
      };
      if (editing) await api.put(`/products/${editing.id}`, payload);
      else await api.post("/products", payload);
      toast.success(editing ? "Produto atualizado" : "Produto criado");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900">Produtos</h1>
          <p className="text-sm text-muted-foreground mt-1">Cadastro básico do cardápio.</p>
        </div>
        <Button onClick={openCreate} data-testid="new-product-button">
          <Plus className="w-4 h-4 mr-1.5" /> Novo Produto
        </Button>
      </header>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Produto</th>
              <th className="px-4 py-2.5 font-semibold">Categoria</th>
              <th className="px-4 py-2.5 font-semibold text-right">Preço</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold w-16"></th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr><td colSpan="5" className="px-4 py-12 text-center">
                <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <div className="text-sm text-muted-foreground">Nenhum produto cadastrado.</div>
              </td></tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className="border-t" data-testid={`product-row-${p.id}`}>
                <td className="px-4 py-3">
                  <div className="font-medium">{p.name}</div>
                  {p.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{p.description}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{p.category}</td>
                <td className="px-4 py-3 text-right font-medium">{brl(p.price)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {p.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => openEdit(p)} data-testid={`edit-product-${p.id}`} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900">
                    <Pencil className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="product-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Preço (R$)</Label>
                <Input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} data-testid="product-price-input" />
              </div>
              <div>
                <Label>Categoria</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="product-category-input" />
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="product-description-input" />
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <Label htmlFor="active">Ativo (disponível para novos pedidos)</Label>
              <Switch id="active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="product-active-switch" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={saving} data-testid="save-product-button">{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
