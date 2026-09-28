import { useEffect, useState } from "react";
import { Plus, Pencil, KeyRound, ShieldCheck, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { api, formatApiError } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ActivePill } from "@/components/StatusBadge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";
import { hasPermission } from "@/lib/permissions";

const ROLE_LABEL = { admin: "Administrador", manager: "Gerente", waiter: "Atendimento", kitchen: "Cozinha" };
const ROLES = ["admin", "manager", "waiter", "kitchen"];
const emptyCreate = { name: "", email: "", temp_password: "", role: "waiter", custom_role_id: null, permissions: [], require_password_change: false };
const emptyCustomRole = { name: "", permissions: [] };

export default function UsersPage() {
  useDocumentTitle("Usuários");
  const { user } = useAuth();
  const canManage = hasPermission(user, "users.manage");
  const [users, setUsers] = useState([]);
  const [permissionGroups, setPermissionGroups] = useState([]);
  const [presets, setPresets] = useState({});
  const [customRoles, setCustomRoles] = useState([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openReset, setOpenReset] = useState(false);
  const [openManageRoles, setOpenManageRoles] = useState(false);
  const [openCustomRole, setOpenCustomRole] = useState(false);
  const [target, setTarget] = useState(null);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editForm, setEditForm] = useState({ name: "", role: "waiter", custom_role_id: null, active: true, permissions: [] });
  const [customRoleTarget, setCustomRoleTarget] = useState(null);
  const [customRoleApplyTo, setCustomRoleApplyTo] = useState(null);
  const [customRoleForm, setCustomRoleForm] = useState(emptyCustomRole);
  const [tempPw, setTempPw] = useState("");
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [usersResponse, permissionsResponse, customRolesResponse] = await Promise.all([
        api.get("/users"), api.get("/users/permissions"), api.get("/users/custom-roles"),
      ]);
      setUsers(usersResponse.data);
      setPermissionGroups(permissionsResponse.data.groups);
      setPresets(permissionsResponse.data.presets);
      setCustomRoles(customRolesResponse.data);
    } catch (e) { toast.error(formatApiError(e)); }
  };
  useEffect(() => { load(); }, []);

  if (user && !hasPermission(user, "users.view")) return <Navigate to="/" replace />;

  const openCreateDialog = () => {
    setCreateForm({ ...emptyCreate, permissions: [...(presets.waiter || [])] });
    setOpenCreate(true);
  };

  const applyRolePreset = (form, setForm, value, applyTo) => {
    if (value === "__create__") {
      setCustomRoleTarget(null);
      setCustomRoleApplyTo(applyTo);
      setCustomRoleForm(emptyCustomRole);
      setOpenCustomRole(true);
      return;
    }
    if (value.startsWith("custom:")) {
      const customRole = customRoles.find((item) => item.id === value.slice(7));
      if (customRole) setForm({ ...form, role: "waiter", custom_role_id: customRole.id, permissions: [...customRole.permissions] });
      return;
    }
    const role = value.replace(/^builtin:/, "");
    setForm({ ...form, role, custom_role_id: null, permissions: [...(presets[role] || [])] });
  };

  const roleValue = (form) => form.custom_role_id ? `custom:${form.custom_role_id}` : `builtin:${form.role}`;

  const saveCustomRole = async () => {
    setSaving(true);
    try {
      const request = customRoleTarget
        ? api.put(`/users/custom-roles/${customRoleTarget.id}`, customRoleForm)
        : api.post("/users/custom-roles", customRoleForm);
      const { data } = await request;
      if (customRoleApplyTo === "create") {
        setCreateForm((current) => ({ ...current, role: "waiter", custom_role_id: data.id, permissions: [...data.permissions] }));
      } else if (customRoleApplyTo === "edit") {
        setEditForm((current) => ({ ...current, role: "waiter", custom_role_id: data.id, permissions: [...data.permissions] }));
      }
      toast.success(customRoleTarget ? "Cargo atualizado" : "Cargo criado");
      setOpenCustomRole(false);
      setCustomRoleTarget(null);
      setCustomRoleApplyTo(null);
      await load();
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };

  const editCustomRole = (role) => {
    setOpenManageRoles(false);
    setCustomRoleTarget(role);
    setCustomRoleApplyTo(null);
    setCustomRoleForm({ name: role.name, permissions: [...role.permissions] });
    setOpenCustomRole(true);
  };

  const deleteCustomRole = async (role) => {
    try {
      await api.delete(`/users/custom-roles/${role.id}`);
      toast.success("Cargo excluído");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const togglePermission = (form, setForm, permission, checked) => {
    const current = new Set(form.permissions);
    if (checked) current.add(permission); else current.delete(permission);
    setForm({ ...form, permissions: [...current] });
  };

  const submitCreate = async () => {
    setSaving(true);
    try {
      await api.post("/users", createForm);
      toast.success(createForm.require_password_change
        ? "Usuário criado. A troca de senha será exigida no próximo login."
        : "Usuário criado.");
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
      await api.post(`/users/${target.id}/reset-password`, {
        new_temp_password: tempPw,
        require_password_change: requirePasswordChange,
      });
      toast.success(requirePasswordChange
        ? "Senha redefinida. A troca será exigida no próximo login."
        : "Senha redefinida.");
      setOpenReset(false); setTempPw(""); setRequirePasswordChange(false); load();
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Usuários"
        subtitle="Gerencie a equipe do restaurante"
        action={canManage ? <Button onClick={openCreateDialog} data-testid="new-user-button"><Plus className="w-4 h-4 mr-1.5" /> Novo Usuário</Button> : null}
      />

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Nome</th>
              <th className="px-4 py-2.5 font-semibold">Email</th>
              <th className="px-4 py-2.5 font-semibold">Cargo</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold w-32"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan="5">
                <EmptyState
                  icon={Users}
                  title="Nenhum usuário cadastrado"
                  action={canManage ? <Button size="sm" onClick={openCreateDialog}><Plus className="w-4 h-4 mr-1.5" /> Novo Usuário</Button> : null}
                />
              </td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t" data-testid={`user-row-${u.id}`}>
                <td className="px-4 py-3 font-medium">
                  <span className="flex items-center gap-2">{u.name}{u.must_change_password && <span title="Senha temporária" className="text-amber-600"><ShieldCheck className="w-3.5 h-3.5" /></span>}</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3 text-foreground">{customRoles.find((role) => role.id === u.custom_role_id)?.name || ROLE_LABEL[u.role]}</td>
                <td className="px-4 py-3"><ActivePill active={u.active} /></td>
                <td className="px-4 py-3">
                  {canManage && <><button onClick={() => { setTarget(u); setEditForm({ name: u.name, role: u.role, custom_role_id: u.custom_role_id || null, active: u.active, permissions: [...u.permissions] }); setOpenEdit(true); }} data-testid={`edit-user-${u.id}`} className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Editar"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => { setTarget(u); setTempPw(""); setRequirePasswordChange(false); setOpenReset(true); }} data-testid={`reset-user-${u.id}`} className="p-1.5 rounded hover:bg-muted text-muted-foreground ml-1" title="Redefinir senha"><KeyRound className="w-4 h-4" /></button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Novo Usuário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} data-testid="user-name-input" /></div>
            <div><Label>Email</Label><Input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} data-testid="user-email-input" /></div>
            <div><Label>Senha</Label><Input type="text" value={createForm.temp_password} onChange={(e) => setCreateForm({ ...createForm, temp_password: e.target.value })} placeholder="Mínimo 6 caracteres" data-testid="user-password-input" /></div>
            <div><Label>Cargo</Label>
              <Select value={roleValue(createForm)} onValueChange={(v) => applyRolePreset(createForm, setCreateForm, v, "create")}>
                <SelectTrigger className="mt-1.5" data-testid="user-role-select"><SelectValue /></SelectTrigger>
                <RoleOptions customRoles={customRoles} canManage={canManage} />
              </Select>
              {canManage && customRoles.length > 0 && <button type="button" onClick={() => setOpenManageRoles(true)} className="mt-1 text-xs text-primary hover:underline">Gerenciar cargos personalizados</button>}
            </div>
            <PermissionsEditor groups={permissionGroups} permissions={createForm.permissions}
              onChange={(permission, checked) => togglePermission(createForm, setCreateForm, permission, checked)} />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={createForm.require_password_change}
                data-testid="require-password-change-create"
                onCheckedChange={(checked) => setCreateForm({ ...createForm, require_password_change: checked === true })} />
              Exigir troca de senha no próximo login
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancelar</Button>
            <Button onClick={submitCreate} disabled={saving} data-testid="save-user-button">{saving ? "Criando..." : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div><Label>Cargo</Label>
              <Select value={roleValue(editForm)} onValueChange={(v) => applyRolePreset(editForm, setEditForm, v, "edit")}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <RoleOptions customRoles={customRoles} canManage={canManage} />
              </Select>
              {canManage && customRoles.length > 0 && <button type="button" onClick={() => setOpenManageRoles(true)} className="mt-1 text-xs text-primary hover:underline">Gerenciar cargos personalizados</button>}
            </div>
            <PermissionsEditor groups={permissionGroups} permissions={editForm.permissions}
              onChange={(permission, checked) => togglePermission(editForm, setEditForm, permission, checked)} />
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
            <p className="text-sm text-muted-foreground">Defina uma nova senha para <b>{target?.name}</b>.</p>
            <div><Label>Nova senha</Label><Input type="text" value={tempPw} onChange={(e) => setTempPw(e.target.value)} placeholder="Mínimo 6 caracteres" data-testid="reset-password-input" /></div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={requirePasswordChange}
                data-testid="require-password-change-reset"
                onCheckedChange={(checked) => setRequirePasswordChange(checked === true)} />
              Exigir troca de senha no próximo login
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenReset(false)}>Cancelar</Button>
            <Button onClick={submitReset} disabled={saving || tempPw.length < 6} data-testid="confirm-reset-button">Redefinir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openManageRoles} onOpenChange={setOpenManageRoles}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cargos personalizados</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {customRoles.map((role) => <div key={role.id} className="flex items-center gap-2 rounded-md border p-3">
              <span className="flex-1 font-medium text-sm">{role.name}</span>
              <button type="button" onClick={() => editCustomRole(role)} className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Editar cargo"><Pencil className="w-4 h-4" /></button>
              <button type="button" onClick={() => deleteCustomRole(role)} className="p-1.5 rounded hover:bg-muted text-destructive" title="Excluir cargo"><Trash2 className="w-4 h-4" /></button>
            </div>)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenManageRoles(false)}>Fechar</Button>
            <Button onClick={() => { setOpenManageRoles(false); setCustomRoleTarget(null); setCustomRoleApplyTo(null); setCustomRoleForm(emptyCustomRole); setOpenCustomRole(true); }}><Plus className="w-4 h-4 mr-1.5" /> Criar cargo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openCustomRole} onOpenChange={setOpenCustomRole}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{customRoleTarget ? "Editar cargo" : "Criar cargo"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome do cargo</Label><Input value={customRoleForm.name} onChange={(e) => setCustomRoleForm({ ...customRoleForm, name: e.target.value })} placeholder="Ex.: Garçom" /></div>
            <PermissionsEditor groups={permissionGroups} permissions={customRoleForm.permissions}
              onChange={(permission, checked) => togglePermission(customRoleForm, setCustomRoleForm, permission, checked)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCustomRole(false)}>Cancelar</Button>
            <Button onClick={saveCustomRole} disabled={saving || !customRoleForm.name.trim()}>{saving ? "Salvando..." : "Salvar cargo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleOptions({ customRoles, canManage }) {
  return <SelectContent>
    {ROLES.map((role) => <SelectItem key={role} value={`builtin:${role}`}>{ROLE_LABEL[role]}</SelectItem>)}
    {customRoles.map((role) => <SelectItem key={role.id} value={`custom:${role.id}`}>{role.name}</SelectItem>)}
    {canManage && <SelectItem value="__create__">+ Criar cargo</SelectItem>}
  </SelectContent>;
}

function PermissionsEditor({ groups, permissions, onChange }) {
  const selected = new Set(permissions);
  return <div className="space-y-2 pt-2 border-t">
    <Label>Permissões</Label>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
      {groups.map((group) => <div key={group.key} className="rounded-md border p-3">
        <div className="text-sm font-semibold mb-2">{group.label}</div>
        <div className="space-y-2">
          {group.permissions.map((permission) => <label key={permission.key} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.has(permission.key)}
              onCheckedChange={(checked) => onChange(permission.key, checked === true)} />
            {permission.label}
          </label>)}
        </div>
      </div>)}
    </div>
  </div>;
}
