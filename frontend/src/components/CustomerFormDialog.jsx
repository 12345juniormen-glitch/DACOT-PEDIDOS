import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
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
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

const empty = { name: "", phone: "", notes: "" };

/**
 * Shared create/edit customer form (same fields, endpoint and validation as
 * CustomersPage), rendered as a Dialog so it can be reused anywhere a
 * customer needs to be created on the fly (e.g. Novo Pedido).
 */
export function CustomerFormDialog({ open, onOpenChange, editing = null, onSaved, onDeleted }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? { name: editing.name, phone: editing.phone || "", notes: editing.notes || "" } : empty);
    setDeleteOpen(false);
    setDeleteConfirmation("");
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

  const permanentlyDelete = async () => {
    if (!editing || deleteConfirmation.trim() !== editing.name) return;
    setDeleting(true);
    try {
      await api.delete(`/customers/${editing.id}/permanent`);
      toast.success("Cliente excluído definitivamente");
      setDeleteOpen(false);
      onOpenChange(false);
      onDeleted?.(editing);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setDeleteOpen(false);
      }}>
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
            {editing && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                <div className="font-semibold text-destructive">Zona de risco</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Exclui o cadastro e o remove das conversas ativas. Pedidos e mensagens antigas permanecem preservados.
                </p>
                <Button
                  type="button"
                  variant="destructive"
                  className="mt-3 w-full sm:w-auto"
                  onClick={() => {
                    setDeleteConfirmation("");
                    setDeleteOpen(true);
                  }}
                  data-testid="permanent-delete-customer-button"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir permanentemente
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="cancel-customer-dialog">Cancelar</Button>
            <Button onClick={submit} disabled={saving} data-testid="save-customer-button">{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={(nextOpen) => {
        if (deleting) return;
        setDeleteOpen(nextOpen);
        if (!nextOpen) setDeleteConfirmation("");
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove “{editing?.name}” do cadastro e das conversas ativas. Pedidos e mensagens históricas não serão apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="customer-delete-confirmation">
              Digite <span className="font-semibold text-foreground">{editing?.name}</span> para confirmar
            </Label>
            <Input
              id="customer-delete-confirmation"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="mt-2"
              autoComplete="off"
              data-testid="customer-delete-confirmation-input"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting || deleteConfirmation.trim() !== editing?.name}
              onClick={(event) => {
                event.preventDefault();
                permanentlyDelete();
              }}
              data-testid="confirm-permanent-delete-customer-button"
            >
              {deleting ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
