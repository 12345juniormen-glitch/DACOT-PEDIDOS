import { useEffect, useRef } from "react";

const OFFSCREEN_POINTER = -10000;

class Particle {
  constructor(x, y, size) {
    this.x = x + (Math.random() - 0.5) * 8;
    this.y = y + (Math.random() - 0.5) * 8;
    this.originX = x;
    this.originY = y;
    this.vx = 0;
    this.vy = 0;
    this.size = size;
  }

  update(pointerX, pointerY, dispersion, returnSpeed) {
    const dx = pointerX - this.x;
    const dy = pointerY - this.y;
    const distanceSquared = dx * dx + dy * dy;
    const radius = 135;

    if (distanceSquared > 0 && distanceSquared < radius * radius) {
      const distance = Math.sqrt(distanceSquared);
      const force = (radius - distance) / radius;
      this.vx -= (dx / distance) * force * dispersion;
      this.vy -= (dy / distance) * force * dispersion;
    }

    this.vx += (this.originX - this.x) * returnSpeed;
    this.vy += (this.originY - this.y) * returnSpeed;
    this.vx *= 0.84;
    this.vy *= 0.84;
    this.x += this.vx;
    this.y += this.vy;
  }
}

export function CursorDrivenParticleTypography({
  text,
  className = "",
  color,
  fontFamily = "Inter, sans-serif",
  state = "idle",
  onExplosionComplete,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const stateRef = useRef(state);
  const completionRef = useRef(onExplosionComplete);

  useEffect(() => {
    stateRef.current = state;
    completionRef.current = onExplosionComplete;
  }, [onExplosionComplete, state]);

  useEffect(() => {
    stateRef.current = state;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const context = canvas?.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!canvas || !container || !context) return undefined;

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    let particles = [];
    let width = 0;
    let height = 0;
    let frameId;
    let resizeTimer;
    let pointerX = OFFSCREEN_POINTER;
    let pointerY = OFFSCREEN_POINTER;
    let visible = !document.hidden;
    let explosionStartedAt = null;
    let explosionCompleted = false;
    const resolveColor = () => {
      if (color) return color;
      const primary = window.getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
      return primary ? `hsl(${primary})` : "#B9572A";
    };
    let particleColor = resolveColor();

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = particleColor;
      for (const particle of particles) {
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fill();
      }
    };

    const buildParticles = () => {
      width = Math.max(1, container.clientWidth);
      height = Math.max(1, container.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const mobile = width < 640 || window.matchMedia("(pointer: coarse)").matches;
      const fontSize = Math.min(width * (mobile ? 0.29 : 0.235), height * 0.42, 290);
      const sampleStep = mobile ? 10 : 6;
      const particleSize = mobile ? 1.25 : 1.5;
      const maxParticles = mobile ? 1300 : 4800;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const source = document.createElement("canvas");
      source.width = width;
      source.height = height;
      const sourceContext = source.getContext("2d", { willReadFrequently: true });
      sourceContext.fillStyle = "#fff";
      sourceContext.font = `900 ${fontSize}px ${fontFamily}`;
      sourceContext.textAlign = "center";
      sourceContext.textBaseline = "middle";
      sourceContext.fillText(text, width / 2, height / 2);
      const pixels = sourceContext.getImageData(0, 0, width, height).data;

      const nextParticles = [];
      outer: for (let y = 0; y < height; y += sampleStep) {
        for (let x = 0; x < width; x += sampleStep) {
          if (pixels[(y * width + x) * 4 + 3] > 128) {
            nextParticles.push(new Particle(x, y, particleSize));
            if (nextParticles.length >= maxParticles) break outer;
          }
        }
      }
      particles = nextParticles;
      draw();
    };

    const startExplosion = (now) => {
      explosionStartedAt = now;
      explosionCompleted = false;
      pointerX = OFFSCREEN_POINTER;
      pointerY = OFFSCREEN_POINTER;
      const centerX = width / 2;
      const centerY = height / 2;
      for (const particle of particles) {
        const dx = particle.x - centerX;
        const dy = particle.y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const speed = 5 + Math.random() * 8;
        particle.vx = (dx / distance) * speed + (Math.random() - 0.5) * 5;
        particle.vy = (dy / distance) * speed + (Math.random() - 0.5) * 5;
      }
    };

    const completeExplosion = () => {
      if (explosionCompleted) return;
      explosionCompleted = true;
      completionRef.current?.();
    };

    const animate = (now) => {
      if (!visible) return;
      const currentState = stateRef.current;
      const exploding = currentState === "explode";
      if (exploding && explosionStartedAt === null) startExplosion(now);
      if (!exploding && explosionStartedAt !== null) {
        explosionStartedAt = null;
        explosionCompleted = false;
      }

      context.clearRect(0, 0, width, height);
      context.fillStyle = particleColor;

      if (exploding) {
        const duration = reducedMotion ? 220 : 560;
        const progress = Math.min(1, (now - explosionStartedAt) / duration);
        context.globalAlpha = 1 - progress;
        for (const particle of particles) {
          if (!reducedMotion) {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vx *= 1.018;
            particle.vy *= 1.018;
          }
          context.beginPath();
          context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = 1;
        if (progress >= 1) {
          completeExplosion();
          return;
        }
      } else {
        for (const particle of particles) {
          if (!reducedMotion) {
            const dispersion = currentState === "loading" ? 7 : 17;
            particle.update(pointerX, pointerY, dispersion, 0.075);
          }
          context.beginPath();
          context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
          context.fill();
        }
      }
      frameId = window.requestAnimationFrame(animate);
    };

    const restartAnimation = () => {
      window.cancelAnimationFrame(frameId);
      if (visible && (!reducedMotion || stateRef.current === "explode")) {
        frameId = window.requestAnimationFrame(animate);
      }
    };

    const handlePointerMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
    };
    const handlePointerLeave = () => {
      pointerX = OFFSCREEN_POINTER;
      pointerY = OFFSCREEN_POINTER;
    };
    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        buildParticles();
        restartAnimation();
      }, 120);
    };
    const handleMotionChange = (event) => {
      reducedMotion = event.matches;
      if (reducedMotion) draw();
      restartAnimation();
    };
    const handleVisibility = () => {
      visible = !document.hidden;
      restartAnimation();
    };
    const themeObserver = new MutationObserver(() => {
      particleColor = resolveColor();
      if (reducedMotion) draw();
    });

    buildParticles();
    restartAnimation();
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("blur", handlePointerLeave);
    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibility);
    reducedMotionQuery.addEventListener?.("change", handleMotionChange);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("pointermove", handlePointerMove);
      document.documentElement.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("blur", handlePointerLeave);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotionQuery.removeEventListener?.("change", handleMotionChange);
      themeObserver.disconnect();
    };
  }, [color, fontFamily, state, text]);

  return (
    <div ref={containerRef} aria-hidden="true" className={`pointer-events-none ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
