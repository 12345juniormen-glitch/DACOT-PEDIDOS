import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { api, formatApiError } from "@/lib/api";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function FirstAccessPage() {
  useDocumentTitle("Primeiro acesso");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(token ? "" : "Convite inválido ou ausente.");

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 6) return setError("A senha precisa ter pelo menos 6 caracteres.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    setLoading(true);
    setError("");
    try {
      await api.post("/auth/first-access", { token, password });
      navigate("/login", { replace: true, state: { firstAccessComplete: true } });
    } catch (requestError) {
      setError(formatApiError(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display font-extrabold text-xl leading-none tracking-tight">DACOT</div>
              <div className="text-[11px] text-muted-foreground mt-1">Sistema para restaurantes</div>
            </div>
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">Crie sua senha</h1>
          <p className="text-sm text-muted-foreground mt-1">Finalize seu primeiro acesso ao painel de pedidos.</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">Nova senha</Label>
              <PasswordInput id="password" autoComplete="new-password" value={password}
                onChange={(event) => setPassword(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirmar senha</Label>
              <PasswordInput id="confirm" autoComplete="new-password" value={confirm}
                onChange={(event) => setConfirm(event.target.value)} required />
            </div>
            {error && <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-none px-3 py-2">{error}</div>}
            <Button type="submit" disabled={loading || !token} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar senha"}
            </Button>
            <Link to="/login" className="block text-center text-xs text-muted-foreground hover:text-foreground">Voltar ao login</Link>
          </form>
        </div>
      </div>
      <div className="hidden lg:flex items-center justify-center bg-secondary text-secondary-foreground p-12">
        <div className="max-w-sm">
          <div className="w-11 h-11 rounded-md bg-primary text-primary-foreground flex items-center justify-center mb-6">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <h2 className="font-display text-2xl font-bold leading-snug">Seu restaurante já está conectado ao DACOT Pedidos.</h2>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">Defina uma senha pessoal para acessar com segurança.</p>
        </div>
      </div>
    </div>
  );
}
