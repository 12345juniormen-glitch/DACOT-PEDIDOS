import { useCallback, useRef, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ParticleEntryTransition, useParticleEntryTransition } from "@/components/auth/ParticleEntryTransition";
import { toast } from "sonner";

export default function LoginPage() {
  useDocumentTitle("Login");
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loginAttemptRef = useRef(false);

  const finishNavigation = useCallback(() => {
    toast.success("Bem-vindo ao DACOT");
    nav("/", { replace: true });
  }, [nav]);
  const { animationState, startTransition, finishTransition } = useParticleEntryTransition(finishNavigation);

  if (user && typeof user === "object" && !loginAttemptRef.current) {
    return <Navigate to="/" replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    if (loading || animationState !== "idle") return;
    loginAttemptRef.current = true;
    setLoading(true);
    setError("");
    const res = await login(email, password);
    setLoading(false);
    if (res.ok && res.user && typeof res.user === "object") {
      document.activeElement?.blur();
      startTransition();
    } else {
      loginAttemptRef.current = false;
      setError(res.error || "Não foi possível carregar os dados do restaurante. Tente novamente.");
    }
  };

  return (
    <ParticleEntryTransition
      animationState={animationState}
      onExplosionComplete={finishTransition}
      className="dark !items-start !px-5 !pb-[max(2rem,env(safe-area-inset-bottom))] !pt-[max(2rem,env(safe-area-inset-top))] md:!items-center md:!px-8 md:!py-8"
    >
      <main
        aria-hidden={animationState !== "idle"}
        className={`relative z-10 w-full max-w-md border-0 bg-transparent p-0 shadow-none backdrop-blur-none transition-all duration-300 md:p-8 ${
          animationState === "idle"
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div className="w-full">
          <h1 className="text-[32px] font-display font-bold leading-[1.1] tracking-tight text-foreground md:text-[40px]">
            <span className="block">Bem-vindo ao</span>
            <span className="block whitespace-nowrap"><span className="text-[#A56D45]">DACOT</span> Pedidos</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Acesse o painel de pedidos do seu restaurante.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4 md:mt-8">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                data-testid="login-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="h-11 bg-card md:h-9"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <PasswordInput
                id="password"
                data-testid="login-password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11 bg-card md:h-9"
                required
              />
            </div>
            {error && (
              <div
                data-testid="login-error"
                className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-none px-3 py-2"
              >
                {error}
              </div>
            )}
            <Button
              type="submit"
              data-testid="login-submit-button"
              disabled={loading || animationState !== "idle"}
              className="h-11 w-full md:h-9"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
            </Button>
          </form>
        </div>
      </main>
    </ParticleEntryTransition>
  );
}
