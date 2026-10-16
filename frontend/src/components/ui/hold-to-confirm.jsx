import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/utils";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return reduced;
}

export function HoldToConfirm({
  children = "Segure para excluir",
  confirmLabel = "Exclusão confirmada",
  loadingLabel = "Excluindo...",
  duration = 1800,
  disabled = false,
  onConfirm,
  onAbort,
  className,
  ...props
}) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("idle");
  const phaseRef = useRef("idle");
  const frameRef = useRef(0);
  const startedAtRef = useRef(0);
  const originRef = useRef(null);
  const wasDisabledRef = useRef(disabled);
  const confirmRef = useRef(onConfirm);
  const abortRef = useRef(onAbort);
  const reducedMotion = usePrefersReducedMotion();
  const hintId = useId();

  confirmRef.current = onConfirm;
  abortRef.current = onAbort;

  const moveTo = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const reset = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    startedAtRef.current = 0;
    originRef.current = null;
    setProgress(0);
    moveTo("idle");
  }, [moveTo]);

  const cancel = useCallback(() => {
    if (phaseRef.current !== "holding") return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    originRef.current = null;
    setProgress(0);
    moveTo("idle");
    abortRef.current?.();
  }, [moveTo]);

  const begin = useCallback((point = null) => {
    if (disabled || phaseRef.current !== "idle") return;
    originRef.current = point;
    startedAtRef.current = performance.now();
    moveTo("holding");

    const tick = (now) => {
      if (phaseRef.current !== "holding") return;
      const rawProgress = Math.min(1, (now - startedAtRef.current) / duration);
      const visibleProgress = reducedMotion ? Math.floor(rawProgress * 10) / 10 : rawProgress;
      setProgress(visibleProgress);

      if (rawProgress >= 1) {
        frameRef.current = 0;
        originRef.current = null;
        setProgress(1);
        moveTo("committed");
        navigator.vibrate?.(14);
        confirmRef.current?.();
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
  }, [disabled, duration, moveTo, reducedMotion]);

  useEffect(() => {
    if (disabled && phaseRef.current === "holding") cancel();
    if (wasDisabledRef.current && !disabled && phaseRef.current === "committed") {
      reset();
    }
    wasDisabledRef.current = disabled;
  }, [cancel, disabled, reset]);

  useEffect(() => {
    const cancelOnHidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancelOnHidden);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancelOnHidden);
      cancelAnimationFrame(frameRef.current);
    };
  }, [cancel]);

  const committed = phase === "committed";
  const label = disabled ? loadingLabel : committed ? confirmLabel : children;
  const seconds = Math.round(duration / 100) / 10;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled || committed}
      aria-describedby={hintId}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        begin({ x: event.clientX, y: event.clientY });
      }}
      onPointerMove={(event) => {
        const origin = originRef.current;
        if (phaseRef.current !== "holding" || !origin) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
          return;
        }
        if (event.repeat) return;
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          begin();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") cancel();
      }}
      onBlur={cancel}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      style={{ touchAction: "none", WebkitTouchCallout: "none" }}
      className={cn(
        "relative isolate inline-grid h-11 select-none place-items-center overflow-hidden rounded-sm border border-destructive/40 bg-destructive/10 px-4 text-sm font-semibold text-destructive outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        !disabled && !committed && "cursor-pointer",
        className,
      )}
      {...props}
    >
      <span className="relative z-10 col-start-1 row-start-1 flex items-center justify-center gap-2 whitespace-nowrap">
        {label}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 z-20 grid place-items-center bg-destructive px-4 text-destructive-foreground",
          phase === "holding" ? "transition-none" : "transition-[clip-path] duration-200 ease-out",
          "motion-reduce:transition-none",
        )}
        style={{ clipPath: `inset(0 ${100 - progress * 100}% 0 0)` }}
      >
        <span className="flex items-center justify-center gap-2 whitespace-nowrap">{label}</span>
      </span>
      <span id={hintId} className="sr-only">
        Mantenha pressionado por {seconds} segundos para confirmar. Soltar antes cancela a exclusão.
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {committed ? confirmLabel : phase === "holding" ? "Confirmando exclusão" : ""}
      </span>
    </button>
  );
}

export default HoldToConfirm;
