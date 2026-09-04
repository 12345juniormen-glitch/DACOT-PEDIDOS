import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UtensilsCrossed, ShieldAlert } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function ChangePasswordPage({ forced = false }) {
  useDocumentTitle("Alterar Senha");
  const { user, refresh, logout } = useAuth();
  const nav = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 6) return toast.error("A nova senha precisa ter pelo menos 6 caracteres");
    if (next !== confirm) return toast.error("As senhas não coincidem");
    setSaving(true);
    try {
      await api.post("/auth/change-password", { current_password: current, new_password: next });
      toast.success("Senha alterada com sucesso");
      await refresh?.();
      nav("/", { replace: true });
    } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center"><UtensilsCrossed className="w-5 h-5" /></div>
          <div><div className="font-display font-extrabold text-xl leading-none">DACOT</div><div className="text-[11px] text-muted-foreground mt-1">Alterar senha</div></div>
        </div>
        {forced && (
          <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-sm text-amber-900 flex gap-2">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <div>Sua senha é temporária. Defina uma nova senha para continuar usando o DACOT.</div>
          </div>
        )}
        <h1 className="text-2xl font-display font-bold text-slate-900">Alterar senha</h1>
        <p className="text-sm text-muted-foreground mt-1">Usuário: {user?.email}</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div><Label>Senha atual</Label><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required data-testid="current-password-input" /></div>
          <div><Label>Nova senha</Label><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required data-testid="new-password-input" /></div>
          <div><Label>Confirmar nova senha</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-testid="confirm-password-input" /></div>
          <Button type="submit" disabled={saving} className="w-full" data-testid="submit-change-password">{saving ? "Alterando..." : "Alterar senha"}</Button>
          {!forced && <button type="button" onClick={() => nav(-1)} className="w-full text-xs text-muted-foreground hover:text-slate-900">Voltar</button>}
          {forced && <button type="button" onClick={logout} className="w-full text-xs text-muted-foreground hover:text-slate-900">Sair</button>}
        </form>
      </div>
    </div>
  );
}
