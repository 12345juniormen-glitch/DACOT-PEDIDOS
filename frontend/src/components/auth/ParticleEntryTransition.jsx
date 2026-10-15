import { useCallback, useEffect, useRef, useState } from "react";
import { CursorDrivenParticleTypography } from "../ui/cursor-driven-particle-typography";

const MIN_ENTRY_HOLD_MS = 600;
const EXPLOSION_FALLBACK_MS = 800;

export function useParticleEntryTransition(onComplete) {
  const [animationState, setAnimationState] = useState("idle");
  const startedAtRef = useRef(0);
  const completedRef = useRef(false);
  const stateRef = useRef("idle");
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const startTransition = useCallback(() => {
    if (stateRef.current !== "idle") return;
    completedRef.current = false;
    startedAtRef.current = Date.now();
    stateRef.current = "loading";
    setAnimationState("loading");
  }, []);

  const finishTransition = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current?.();
  }, []);

  useEffect(() => {
    if (animationState !== "loading") return undefined;
    const elapsed = Date.now() - startedAtRef.current;
    const timer = window.setTimeout(() => {
      stateRef.current = "explode";
      setAnimationState("explode");
    }, Math.max(0, MIN_ENTRY_HOLD_MS - elapsed));
    return () => window.clearTimeout(timer);
  }, [animationState]);

  useEffect(() => {
    if (animationState !== "explode") return undefined;
    const fallback = window.setTimeout(finishTransition, EXPLOSION_FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [animationState, finishTransition]);

  return { animationState, startTransition, finishTransition };
}

export function ParticleEntryTransition({
  animationState = "idle",
  onExplosionComplete,
  children,
  fixed = false,
  className = "",
}) {
  return (
    <div className={`${fixed ? "fixed inset-0" : "relative"} flex min-h-screen min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-5 py-8 sm:px-8 ${className}`}>
      <CursorDrivenParticleTypography
        text="DACOT"
        state={animationState}
        onExplosionComplete={onExplosionComplete}
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
      {children}
    </div>
  );
}
