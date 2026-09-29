import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Minus, Trash2, Search, ShoppingCart, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomerFormDialog } from "@/components/CustomerFormDialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { brl } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";

const CREATE_CUSTOMER = "__create_customer__";

export default function OrderCreatePage({ operational = false }) {
  useDocumentTitle("Novo Pedido");
  const nav = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const preselectedCustomer = searchParams.get("customer");
  const canViewCustomers = hasPermission(user, "customers.view");
  const canManageCustomers = hasPermission(user, "customers.manage");
  const cartRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [customerId, setCustomerId] = useState("none");
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [items, setItems] = useState([]); // { product_id, name, unit_price, quantity, notes }
  const [notes, setNotes] = useState("");
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [p, c] = await Promise.all([
          api.get("/products", { params: { active_only: true } }),
          canViewCustomers ? api.get("/customers") : Promise.resolve({ data: [] }),
        ]);
        setProducts(p.data);
        setCustomers(c.data);
        if (preselectedCustomer && canViewCustomers) {
          const { data: customer } = await api.get(`/customers/${encodeURIComponent(preselectedCustomer)}`);
          setCustomerId(customer.id);
          if (!c.data.some((item) => item.id === customer.id)) setCustomers([...c.data, customer]);
        }
      } catch (e) {
        toast.error(formatApiError(e));
      }
    })();
  }, [canViewCustomers, preselectedCustomer]);

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category || "Geral"))].sort(),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const s = productSearch.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCategory = category === "all" || (p.category || "Geral") === category;
      const matchesSearch = !s || p.name.toLowerCase().includes(s) || (p.category || "").toLowerCase().includes(s);
      return matchesCategory && matchesSearch;
    });
  }, [category, products, productSearch]);

  const addProduct = (p) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product_id === p.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === p.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [...prev, { product_id: p.id, name: p.name, unit_price: p.price, quantity: 1, notes: "" }];
    });
  };

  const updateQty = (id, delta) => {
    setItems((prev) =>
      prev
        .map((i) => (i.product_id === id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
        .filter((i) => i.quantity > 0),
    );
  };

  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.product_id !== id));

  const updateItemNotes = (id, n) =>
    setItems((prev) => prev.map((i) => (i.product_id === id ? { ...i, notes: n } : i)));

  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const discountNum = Math.max(0, Number(discountValue) || 0);
  const discountAmount =
    discountType === "fixed"
      ? Math.min(discountNum, subtotal)
      : discountType === "percent"
      ? subtotal * Math.min(100, discountNum) / 100
      : 0;
  const total = Math.max(0, subtotal - discountAmount);

  const submit = async () => {
    if (items.length === 0) {
      toast.error("Adicione pelo menos um item");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customer_id: customerId && customerId !== "none" ? customerId : null,
        notes: notes.trim(),
        discount_type: discountType,
        discount_value: discountType === "none" ? 0 : discountNum,
        items: items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          notes: i.notes || "",
        })),
      };
      const { data } = await api.post("/orders", payload);
      toast.success(`Pedido #${data.order_number} criado`);
      nav(operational ? "/garcom" : `/pedidos/${data.id}`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`p-3 sm:p-6 lg:p-8 max-w-[1400px] mx-auto ${operational ? "pb-28" : ""}`}>
      <PageHeader title="Novo Pedido" subtitle={operational ? undefined : "Selecione produtos e revise antes de criar"} onBack={() => nav(-1)} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: product picker */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produto por nome ou categoria..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                data-testid="product-search-input"
                className="border-0 shadow-none focus-visible:ring-0 px-0"
              />
            </div>
            {operational && categories.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-3 mb-1" aria-label="Categorias de produtos">
                <Button type="button" variant={category === "all" ? "default" : "outline"} onClick={() => setCategory("all")} className="h-11 shrink-0">
                  Todos
                </Button>
                {categories.map((item) => (
                  <Button key={item} type="button" variant={category === item ? "default" : "outline"} onClick={() => setCategory(item)} className="h-11 shrink-0">
                    {item}
                  </Button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 lg:max-h-[480px] lg:overflow-y-auto">
              {filteredProducts.length === 0 && (
                <div className="col-span-full">
                  <EmptyState title="Nenhum produto ativo" description="Cadastre produtos na tela Produtos para começar a montar pedidos." compact />
                </div>
              )}
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  data-testid={`add-product-${p.id}`}
                  className={`text-left border rounded-md p-3 hover:border-primary hover:bg-accent/40 transition-colors ${operational ? "min-h-24 active:bg-accent" : ""}`}
                >
                  <div className="font-medium text-sm text-foreground truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.category}</div>
                  <div className="text-sm font-semibold text-primary mt-1">{brl(p.price)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: resumo do pedido — itens (com destaque) primeiro, depois cliente/obs/desconto/total */}
        <aside className="space-y-4" ref={cartRef}>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Itens do pedido {items.length > 0 && `(${items.length})`}
            </div>
            {items.length === 0 ? (
              <EmptyState title="Nenhum item ainda" description="Toque em um produto ao lado para adicionar ao pedido." compact />
            ) : (
              <div className="space-y-2" data-testid="cart-items">
                {items.map((i) => (
                  <div key={i.product_id} className="border rounded-md p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{i.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {brl(i.unit_price)} × {i.quantity} = <span className="font-medium text-foreground">{brl(i.unit_price * i.quantity)}</span>
                        </div>
                      </div>
                      <button onClick={() => removeItem(i.product_id)} data-testid={`remove-${i.product_id}`} className="p-2 -m-1 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => updateQty(i.product_id, -1)} data-testid={`dec-${i.product_id}`} className={`${operational ? "w-12 h-12" : "w-10 h-10"} border rounded hover:bg-muted flex items-center justify-center shrink-0`}>
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="text-sm font-semibold w-6 text-center">{i.quantity}</span>
                      <button onClick={() => updateQty(i.product_id, 1)} data-testid={`inc-${i.product_id}`} className={`${operational ? "w-12 h-12" : "w-10 h-10"} border rounded hover:bg-muted flex items-center justify-center shrink-0`}>
                        <Plus className="w-4 h-4" />
                      </button>
                      <Input
                        placeholder="Obs. do item"
                        value={i.notes}
                        onChange={(e) => updateItemNotes(i.product_id, e.target.value)}
                        className="h-9 text-xs ml-1"
                        data-testid={`item-notes-${i.product_id}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canViewCustomers && <div className="bg-card border rounded-lg p-4">
            <Label>Cliente (opcional)</Label>
            <Select
              value={customerId}
              onValueChange={(v) => {
                if (v === CREATE_CUSTOMER) {
                  setCustomerDialogOpen(true);
                  return;
                }
                setCustomerId(v);
              }}
            >
              <SelectTrigger className="mt-1.5" data-testid="customer-select">
                <SelectValue placeholder="Selecionar cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem cliente</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} {c.phone ? `— ${c.phone}` : ""}
                  </SelectItem>
                ))}
                {canManageCustomers && <SelectSeparator />}
                {canManageCustomers && <SelectItem value={CREATE_CUSTOMER} className="text-primary font-medium">
                  <span className="inline-flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" /> Criar novo cliente</span>
                </SelectItem>}
              </SelectContent>
            </Select>
          </div>}

          {canManageCustomers && <CustomerFormDialog
            open={customerDialogOpen}
            onOpenChange={setCustomerDialogOpen}
            onSaved={(c) => {
              setCustomers((prev) => [...prev, c]);
              setCustomerId(c.id);
            }}
          />}

          <div className="bg-card border rounded-lg p-4 space-y-3">
            <div>
              <Label>Observações do pedido</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Ex: retirar no balcão, sem cebola..."
                className="mt-1.5"
                data-testid="order-notes-input"
              />
            </div>
            {!operational && <div>
              <Label>Desconto</Label>
              <div className="flex gap-2 mt-1.5">
                <Select value={discountType} onValueChange={setDiscountType}>
                  <SelectTrigger className="w-36" data-testid="discount-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem desconto</SelectItem>
                    <SelectItem value="fixed">R$ (fixo)</SelectItem>
                    <SelectItem value="percent">% (percentual)</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={discountType === "none"}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder={discountType === "percent" ? "0-100" : "0,00"}
                  data-testid="discount-value-input"
                />
              </div>
            </div>}

            <div className="space-y-1.5 text-sm pt-1">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span><span data-testid="subtotal">{brl(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Desconto</span><span data-testid="discount-amount">− {brl(discountAmount)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md bg-accent/50 border border-primary/20 px-3 py-2.5">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="font-display text-xl font-bold text-primary" data-testid="total">{brl(total)}</span>
            </div>

            <Button
              onClick={submit}
              disabled={saving || items.length === 0}
              className={`w-full ${operational ? "h-14 text-base font-bold" : "h-11"}`}
              data-testid="submit-order-button"
            >
              {saving ? "Enviando..." : operational ? "Enviar pedido" : "Criar Pedido"}
            </Button>
          </div>
        </aside>
      </div>
      {operational && items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur p-3 lg:hidden">
          <Button type="button" onClick={() => cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="w-full h-14 text-base font-bold">
            <ShoppingCart className="w-5 h-5 mr-2" /> Ver pedido · {items.reduce((sum, item) => sum + item.quantity, 0)} itens · {brl(total)}
          </Button>
        </div>
      )}
    </div>
  );
}
