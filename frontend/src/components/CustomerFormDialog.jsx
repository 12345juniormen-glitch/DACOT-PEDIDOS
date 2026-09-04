import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

const empty = { name: "", phone: "", notes: "" };

/**
 * Shared create/edit customer form (same fields, endpoint and validation as
 * CustomersPage), rendered as a Dialog so it can be reused anywhere a
 * customer needs to be created on the fly (e.g. Novo Pedido).
 */
export function CustomerFormDialog({ open, onOpenChange, editing = null, onSaved }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? { name: editing.name, phone: editing.phone || "", notes: editing.notes || "" } : empty);
  }, [open, editing]);

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Nome obrigatório");
    setSaving(true);
    try {
      const { data } = editing
        ? await api.put(`/customers/${editing.id}`, form)
        : await api.post("/customers", form);
      toast.success(editing ? "Cliente atualizado" : "Cliente criado");
      onOpenChange(false);
      onSaved?.(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="customer-name-input" />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(11) 99999-9999" data-testid="customer-phone-input" />
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="customer-notes-input" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="cancel-customer-dialog">Cancelar</Button>
          <Button onClick={submit} disabled={saving} data-testid="save-customer-button">{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
