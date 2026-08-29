import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { UtensilsCrossed, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export default function LoginPage() {
  const { user, login, handoffError } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@dacot.app");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(handoffError || "");

  if (user && typeof user === "object") return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await login(email, password);
    setLoading(false);
    if (res.ok) {
      toast.success("Bem-vindo ao DACOT");
      nav("/", { replace: true });
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Left panel: form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display font-extrabold text-xl leading-none tracking-tight">DACOT</div>
              <div className="text-[11px] text-muted-foreground mt-1">Sistema para restaurantes</div>
            </div>
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900">Entrar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Acesse o painel de pedidos do seu restaurante.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                data-testid="login-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                data-testid="login-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <div
                data-testid="login-error"
                className="text-sm text-destructive bg-rose-50 border border-rose-200 rounded-md px-3 py-2"
              >
                {error}
              </div>
            )}
            <Button
              type="submit"
              data-testid="login-submit-button"
              disabled={loading}
              className="w-full"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
            </Button>
          </form>

          <div className="mt-6 text-xs text-muted-foreground border-t pt-4">
            Conta de demonstração: <span className="font-mono">admin@dacot.app</span> / <span className="font-mono">admin123</span>
          </div>
        </div>
      </div>

      {/* Right panel: brand block */}
      <div className="hidden lg:flex items-center justify-center relative bg-gradient-to-br from-orange-500 to-orange-600 text-white p-12">
        <div className="max-w-md">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/15 text-xs font-medium mb-6">
            Primeiro módulo · Pedidos
          </div>
          <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight">
            Centralize seus pedidos.<br />Ganhe agilidade no salão e na cozinha.
          </h2>
          <p className="text-white/85 mt-4 text-sm leading-relaxed">
            Chega de comandas perdidas em papel. Acompanhe cada pedido do "Novo" até o "Entregue" em um único painel — e mantenha todo o histórico à mão.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-white/90">
            <li>· Pedidos com status em tempo real</li>
            <li>· Preço registrado no momento do pedido</li>
            <li>· Histórico consultável a qualquer momento</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
