import { useEffect, useState } from "react";
import { Plus, Pencil, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { api, formatApiError } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";

const ROLE_LABEL = { admin: "Administrador", manager: "Gerente", waiter: "Atendimento", kitchen: "Cozinha" };
const ROLES = ["admin", "manager", "waiter", "kitchen"];
const emptyCreate = { name: "", email: "", temp_password: "", role: "waiter" };

export default function UsersPage() {
  useDocumentTitle("Usuários");
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openReset, setOpenReset] = useState(false);
  const [target, setTarget] = useState(null);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editForm, setEditForm] = useState({ name: "", role: "waiter", active: true });
  const [tempPw, setTempPw] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(data);
    } catch (e) { toast.error(formatApiError(e)); }
  };
  useEffect(() => { load(); }, []);

  if (user && user.role !== "admin") return <Navigate to="/" replace />;

  const submitCreate = async () => {
    setSaving(true);
    try {
      await api.post("/users", createForm);
      toast.success("Usuário criado. Senha temporária definida — o usuário deverá trocá-la no primeiro login.");
      setOpenCreate(false); setCreateForm(emptyCreate); load();
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };
  const submitEdit = async () => {
    setSaving(true);
    try {
      await api.put(`/users/${target.id}`, editForm);
      toast.success("Usuário atualizado");
      setOpenEdit(false); load();
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };
  const submitReset = async () => {
    setSaving(true);
    try {
      await api.post(`/users/${target.id}/reset-password`, { new_temp_password: tempPw });
      toast.success("Senha redefinida. O usuário deverá trocá-la no próximo login.");
      setOpenReset(false); setTempPw(""); load();
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900">Usuários</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie a equipe do restaurante.</p>
        </div>
        <Button onClick={() => setOpenCreate(true)} data-testid="new-user-button"><Plus className="w-4 h-4 mr-1.5" /> Novo Usuário</Button>
      </header>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Nome</th>
              <th className="px-4 py-2.5 font-semibold">Email</th>
              <th className="px-4 py-2.5 font-semibold">Papel</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold w-32"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t" data-testid={`user-row-${u.id}`}>
                <td className="px-4 py-3 font-medium flex items-center gap-2">{u.name}{u.must_change_password && <span title="Senha temporária" className="text-amber-600"><ShieldCheck className="w-3.5 h-3.5" /></span>}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-700">{ROLE_LABEL[u.role]}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${u.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{u.active ? "Ativo" : "Inativo"}</span></td>
                <td className="px-4 py-3">
                  <button onClick={() => { setTarget(u); setEditForm({ name: u.name, role: u.role, active: u.active }); setOpenEdit(true); }} data-testid={`edit-user-${u.id}`} className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title="Editar"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => { setTarget(u); setTempPw(""); setOpenReset(true); }} data-testid={`reset-user-${u.id}`} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 ml-1" title="Redefinir senha"><KeyRound className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Usuário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} data-testid="user-name-input" /></div>
            <div><Label>Email</Label><Input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} data-testid="user-email-input" /></div>
            <div><Label>Senha temporária</Label><Input type="text" value={createForm.temp_password} onChange={(e) => setCreateForm({ ...createForm, temp_password: e.target.value })} placeholder="Mínimo 6 caracteres" data-testid="user-password-input" /></div>
            <div><Label>Papel</Label>
              <Select value={createForm.role} onValueChange={(v) => setCreateForm({ ...createForm, role: v })}>
                <SelectTrigger className="mt-1.5" data-testid="user-role-select"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">O usuário será obrigado a trocar a senha no primeiro login.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancelar</Button>
            <Button onClick={submitCreate} disabled={saving} data-testid="save-user-button">{saving ? "Criando..." : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div><Label>Papel</Label>
              <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between pt-2 border-t"><Label>Ativo</Label><Switch checked={editForm.active} onCheckedChange={(v) => setEditForm({ ...editForm, active: v })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEdit(false)}>Cancelar</Button>
            <Button onClick={submitEdit} disabled={saving} data-testid="update-user-button">{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openReset} onOpenChange={setOpenReset}>
        <DialogContent>
          <DialogHeader><DialogTitle>Redefinir senha</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Uma senha temporária será definida para <b>{target?.name}</b>. O usuário deverá trocá-la no próximo login.</p>
            <div><Label>Nova senha temporária</Label><Input type="text" value={tempPw} onChange={(e) => setTempPw(e.target.value)} placeholder="Mínimo 6 caracteres" data-testid="reset-password-input" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenReset(false)}>Cancelar</Button>
            <Button onClick={submitReset} disabled={saving || tempPw.length < 6} data-testid="confirm-reset-button">Redefinir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
