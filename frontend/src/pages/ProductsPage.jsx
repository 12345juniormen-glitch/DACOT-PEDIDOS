import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Pencil, Package, Trash2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ActivePill } from "@/components/StatusBadge";
import { api, formatApiError } from "@/lib/api";
import { brl } from "@/lib/format";
import { formatPrepClock, parsePrepClock } from "@/lib/prepTime";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { hasPermission } from "@/lib/permissions";

const empty = { name: "", description: "", price: "", category: "Geral", prep_time: "00:00", active: true };

export default function ProductsPage() {
  useDocumentTitle("Produtos");
  const { user } = useAuth();
  const canManage = hasPermission(user, "products.manage");
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Deep link vindo da busca global (?product=<id>): já abre a edição. Reage
  // tanto à lista carregar quanto à própria query mudar — assim funciona também
  // quando o usuário já está em /produtos e busca outro produto (a página não
  // remonta nesse caso).
  useEffect(() => {
    if (products.length === 0) return;
    const productId = searchParams.get("product");
    if (!productId) return;
    const p = products.find((x) => x.id === productId);
    if (p && canManage) openEdit(p);
    const next = new URLSearchParams(searchParams);
    next.delete("product");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openEdit é recriada a cada render; não precisa disparar o efeito de novo
  }, [products, searchParams, setSearchParams, canManage]);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setOpen(true);
  };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description || "",
      price: String(p.price),
      category: p.category,
      prep_time: formatPrepClock(p.prep_time_seconds),
      active: p.active,
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Nome obrigatório");
    const prepTimeSeconds = parsePrepClock(form.prep_time);
    if (prepTimeSeconds === null) return toast.error("Informe o tempo no formato MM:SS");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price) || 0,
        category: form.category.trim() || "Geral",
        prep_time_seconds: prepTimeSeconds,
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

  const permanentlyDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await api.delete(`/products/${editing.id}/permanent`);
      toast.success("Produto excluído definitivamente");
      setDeleteOpen(false);
      setOpen(false);
      setEditing(null);
      setForm(empty);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Produtos"
        subtitle="Cadastro do cardápio usado nos pedidos"
        action={canManage ?
          <Button onClick={openCreate} data-testid="new-product-button">
            <Plus className="w-4 h-4 mr-1.5" /> Novo Produto
          </Button>
        : null}
      />

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Produto</th>
              <th className="px-4 py-2.5 font-semibold">Categoria</th>
              <th className="px-4 py-2.5 font-semibold text-right">Preço</th>
              <th className="px-4 py-2.5 font-semibold">Preparo</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold w-16"></th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr><td colSpan="6">
                <EmptyState
                  icon={Package}
                  title="Nenhum produto cadastrado"
                  description="Cadastre o primeiro produto para começar a montar pedidos."
                  action={canManage ? <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1.5" /> Novo Produto</Button> : null}
                />
              </td></tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className="border-t" data-testid={`product-row-${p.id}`}>
                <td className="px-4 py-3">
                  <div className="font-medium">{p.name}</div>
                  {p.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{p.description}</div>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{p.category}</td>
                <td className="px-4 py-3 text-right font-medium">{brl(p.price)}</td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums">
                  {p.prep_time_seconds > 0 ? formatPrepClock(p.prep_time_seconds) : "Instantâneo"}
                </td>
                <td className="px-4 py-3"><ActivePill active={p.active} /></td>
                <td className="px-4 py-3">
                  {canManage && <button onClick={() => openEdit(p)} data-testid={`edit-product-${p.id}`} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Pencil className="w-4 h-4" />
                  </button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setDeleteOpen(false);
      }}>
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
            <div>
              <Label htmlFor="prep-time">Tempo estimado de preparo</Label>
              <Input
                id="prep-time"
                value={form.prep_time}
                onChange={(e) => setForm({ ...form, prep_time: e.target.value })}
                onBlur={() => {
                  const seconds = parsePrepClock(form.prep_time);
                  if (seconds !== null) setForm((current) => ({ ...current, prep_time: formatPrepClock(seconds) }));
                }}
                placeholder="00:00"
                inputMode="numeric"
                className="mt-1 tabular-nums"
                data-testid="product-prep-time-input"
              />
              <p className="mt-1 text-xs text-muted-foreground">Use MM:SS. Para itens instantâneos, mantenha 00:00.</p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <Label htmlFor="active">Ativo (disponível para novos pedidos)</Label>
              <Switch id="active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="product-active-switch" />
            </div>
            {editing && canManage && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                <div className="font-semibold text-destructive">Zona de risco</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Exclui definitivamente este cadastro do catálogo. Pedidos antigos permanecem preservados.
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  className="mt-3 w-full sm:w-auto"
                  onClick={() => setDeleteOpen(true)}
                  data-testid="permanent-delete-product-button"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir permanentemente
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={saving} data-testid="save-product-button">{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={(nextOpen) => !deleting && setDeleteOpen(nextOpen)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              O produto “{editing?.name}” será removido do catálogo e não poderá ser recuperado. Os pedidos antigos não serão alterados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                permanentlyDelete();
              }}
              data-testid="confirm-permanent-delete-product-button"
            >
              {deleting ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
