import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Alterna Claro/Escuro. Ícone-only, com tooltip — compacto o bastante para caber no header mobile e na sidebar. */
export function ThemeToggle({ className = "" }) {
  const { theme, setTheme } = useTheme();
  // Evita mismatch de hidratação: só sabemos o tema real depois do mount (next-themes lê o localStorage no client).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && theme === "dark";
  const label = isDark ? "Mudar para tema claro" : "Mudar para tema escuro";

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            data-testid="theme-toggle"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={`h-8 w-8 text-muted-foreground hover:text-foreground ${className}`}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
