/* Order edit page — mirrors OrderCreatePage but loads existing order and PUTs. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Minus, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { api, formatApiError } from "@/lib/api";
import { brl } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";

export default function OrderEditPage() {
  useDocumentTitle("Editar Pedido");
  const { id } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [customerId, setCustomerId] = useState("none");
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState("");
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [o, p, c] = await Promise.all([
          api.get(`/orders/${id}`),
          api.get("/products", { params: { active_only: true } }),
          api.get("/customers"),
        ]);
        setOrder(o.data);
        setProducts(p.data);
        setCustomers(c.data);
        setCustomerId(o.data.customer_id || "none");
        setNotes(o.data.notes || "");
        setDiscountType(o.data.discount_type || "none");
        setDiscountValue(o.data.discount_type === "none" ? "" : String(o.data.discount_value));
        setItems(o.data.items.map((i) => ({
          product_id: i.product_id,
          name: i.product_name,
          unit_price: i.unit_price,
          quantity: i.quantity,
          notes: i.notes || "",
        })));
      } catch (e) {
        toast.error(formatApiError(e));
        nav("/");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deve rodar só quando o id muda
  }, [id]);

  const filtered = useMemo(() => {
    const s = productSearch.trim().toLowerCase();
    return !s ? products : products.filter((p) => p.name.toLowerCase().includes(s));
  }, [products, productSearch]);

  const addProduct = (p) => {
    setItems((prev) => {
      const ex = prev.find((i) => i.product_id === p.id);
      if (ex) return prev.map((i) => (i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...prev, { product_id: p.id, name: p.name, unit_price: p.price, quantity: 1, notes: "" }];
    });
  };
  const updateQty = (id, d) =>
    setItems((prev) => prev.map((i) => (i.product_id === id ? { ...i, quantity: Math.max(0, i.quantity + d) } : i)).filter((i) => i.quantity > 0));
  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.product_id !== id));

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const dv = Math.max(0, Number(discountValue) || 0);
  const discountAmount = discountType === "fixed" ? Math.min(dv, subtotal) : discountType === "percent" ? (subtotal * Math.min(100, dv)) / 100 : 0;
  const total = Math.max(0, subtotal - discountAmount);

  const submit = async () => {
    if (items.length === 0) return toast.error("Adicione pelo menos um item");
    setSaving(true);
    try {
      const payload = {
        customer_id: customerId && customerId !== "none" ? customerId : null,
        notes: notes.trim(),
        discount_type: discountType,
        discount_value: discountType === "none" ? 0 : dv,
        items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, notes: i.notes || "" })),
      };
      await api.put(`/orders/${id}`, payload);
      toast.success("Pedido atualizado");
      nav(`/pedidos/${id}`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!order) return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <PageHeader title={`Editar Pedido #${order.order_number}`} onBack={() => nav(-1)} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar produto..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} className="border-0 shadow-none focus-visible:ring-0 px-0" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 lg:max-h-[480px] lg:overflow-y-auto">
            {filtered.length === 0 && (
              <div className="col-span-full">
                <EmptyState title="Nenhum produto encontrado" compact />
              </div>
            )}
            {filtered.map((p) => (
              <button key={p.id} onClick={() => addProduct(p)} className="text-left border rounded-md p-3 hover:border-primary hover:bg-accent/40 transition-colors">
                <div className="font-medium text-sm truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground truncate">{p.category}</div>
                <div className="text-sm font-semibold text-primary mt-1">{brl(p.price)}</div>
              </button>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="bg-white border rounded-lg p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Itens do pedido {items.length > 0 && `(${items.length})`}
            </div>
            {items.length === 0 ? (
              <EmptyState title="Nenhum item" description="Adicione ao menos um produto para salvar." compact />
            ) : (
              <div className="space-y-2">
                {items.map((i) => (
                  <div key={i.product_id} className="border rounded-md p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{i.name}</div>
                        <div className="text-xs text-muted-foreground">{brl(i.unit_price)} × {i.quantity} = {brl(i.unit_price * i.quantity)}</div>
                      </div>
                      <button onClick={() => removeItem(i.product_id)} className="p-2 -m-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => updateQty(i.product_id, -1)} className="w-10 h-10 border rounded hover:bg-slate-50 flex items-center justify-center shrink-0"><Minus className="w-4 h-4" /></button>
                      <span className="text-sm font-semibold w-6 text-center">{i.quantity}</span>
                      <button onClick={() => updateQty(i.product_id, 1)} className="w-10 h-10 border rounded hover:bg-slate-50 flex items-center justify-center shrink-0"><Plus className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border rounded-lg p-4">
            <Label>Cliente</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem cliente</SelectItem>
                {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-white border rounded-lg p-4 space-y-3">
            <div>
              <Label>Observações</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>Desconto</Label>
              <div className="flex gap-2 mt-1.5">
                <Select value={discountType} onValueChange={setDiscountType}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem desconto</SelectItem>
                    <SelectItem value="fixed">R$ (fixo)</SelectItem>
                    <SelectItem value="percent">% (percentual)</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" disabled={discountType === "none"} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5 text-sm pt-1">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Desconto</span><span>− {brl(discountAmount)}</span></div>
            </div>
            <div className="flex items-center justify-between rounded-md bg-accent/50 border border-primary/20 px-3 py-2.5">
              <span className="text-sm font-semibold text-slate-700">Total</span>
              <span className="font-display text-xl font-bold text-primary">{brl(total)}</span>
            </div>
            <Button onClick={submit} disabled={saving || items.length === 0} className="w-full h-11" data-testid="save-order-edit-button">
              {saving ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
