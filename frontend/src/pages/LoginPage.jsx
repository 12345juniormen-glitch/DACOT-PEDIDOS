import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { UtensilsCrossed, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { CursorDrivenParticleTypography } from "@/components/ui/cursor-driven-particle-typography";
import { toast } from "sonner";

const MIN_TRANSITION_MS = 600;
const EXPLOSION_FALLBACK_MS = 800;

export default function LoginPage() {
  useDocumentTitle("Login");
  const { user, login, handoffError } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(handoffError || "");
  const [animationState, setAnimationState] = useState("idle");
  const acceptedAtRef = useRef(0);
  const loginAttemptRef = useRef(false);
  const navigationCompletedRef = useRef(false);

  const finishNavigation = useCallback(() => {
    if (navigationCompletedRef.current) return;
    navigationCompletedRef.current = true;
    toast.success("Bem-vindo ao DACOT");
    nav("/", { replace: true });
  }, [nav]);

  useEffect(() => {
    if (animationState !== "loading" || !user || typeof user !== "object") return undefined;
    const elapsed = Date.now() - acceptedAtRef.current;
    const timer = window.setTimeout(
      () => setAnimationState("explode"),
      Math.max(0, MIN_TRANSITION_MS - elapsed),
    );
    return () => window.clearTimeout(timer);
  }, [animationState, user]);

  useEffect(() => {
    if (animationState !== "explode") return undefined;
    const fallback = window.setTimeout(finishNavigation, EXPLOSION_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [animationState, finishNavigation]);

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
      acceptedAtRef.current = Date.now();
      document.activeElement?.blur();
      setAnimationState("loading");
    } else {
      loginAttemptRef.current = false;
      setError(res.error || "Não foi possível carregar os dados do restaurante. Tente novamente.");
    }
  };

  return (
    <div className="relative flex min-h-screen min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-5 py-8 sm:px-8">
      <CursorDrivenParticleTypography
        text="DACOT"
        state={animationState}
        onExplosionComplete={finishNavigation}
        className={`absolute inset-0 z-0 transition-opacity duration-300 ${
          animationState === "idle" ? "opacity-35 dark:opacity-45" : "opacity-90 dark:opacity-100"
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-0 z-[1] bg-background transition-opacity duration-300 ${
          animationState === "idle" ? "opacity-25 dark:opacity-15" : "opacity-5"
        }`}
        aria-hidden="true"
      />

      <main
        aria-hidden={animationState !== "idle"}
        className={`relative z-10 w-full max-w-md rounded-xl border border-border/80 bg-card/95 p-6 shadow-2xl shadow-black/15 backdrop-blur-sm transition-all duration-300 sm:p-8 dark:shadow-black/40 ${
          animationState === "idle"
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0"
        }`}
      >
        <div className="w-full">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display font-extrabold text-xl leading-none tracking-tight">DACOT</div>
              <div className="text-[11px] text-muted-foreground mt-1">Sistema para restaurantes</div>
            </div>
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">Entrar</h1>
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
                className="text-sm text-destructive bg-rose-50 border border-rose-200 dark:bg-rose-950 dark:border-rose-900 rounded-md px-3 py-2"
              >
                {error}
              </div>
            )}
            <Button
              type="submit"
              data-testid="login-submit-button"
              disabled={loading || animationState !== "idle"}
              className="w-full"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Entrar"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
