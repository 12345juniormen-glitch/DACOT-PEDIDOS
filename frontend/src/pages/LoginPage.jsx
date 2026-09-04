import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { UtensilsCrossed, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUS_ICON } from "@/components/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { STATUS_LABEL } from "@/lib/format";
import { toast } from "sonner";

const FLOW = ["new", "in_preparation", "ready", "delivered"];

export default function LoginPage() {
  useDocumentTitle("Login");
  const { user, login, handoffError } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        </div>
      </div>

      {/* Right panel: identidade — sólido, sem gradiente; o laranja aparece só como acento */}
      <div className="hidden lg:flex items-center justify-center bg-slate-900 text-white p-12">
        <div className="max-w-sm">
          <div className="w-11 h-11 rounded-md bg-primary text-primary-foreground flex items-center justify-center mb-6">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <h2 className="font-display text-2xl font-bold leading-snug">
            Gestão de pedidos para o salão e a cozinha.
          </h2>
          <p className="text-slate-400 mt-3 text-sm leading-relaxed">
            Cada pedido acompanhado do início ao fim, com preço registrado no momento da venda e histórico sempre disponível.
          </p>
          <ol className="mt-10 space-y-3">
            {FLOW.map((s, idx) => {
              const Icon = STATUS_ICON[s];
              return (
                <li key={s} className="flex items-center gap-3 text-sm text-slate-300">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs font-semibold text-slate-400 shrink-0">
                    {idx + 1}
                  </span>
                  <Icon className="w-4 h-4 text-primary shrink-0" />
                  <span>{STATUS_LABEL[s]}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
