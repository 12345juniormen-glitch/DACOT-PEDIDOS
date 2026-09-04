import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Wrapper fino sobre next-themes (já era dependência do projeto, usada por
 * components/ui/sonner.jsx, mas nunca tinha um Provider real montado).
 * attribute="class" casa com o darkMode:["class"] do tailwind.config.js.
 */
export function ThemeProvider({ children }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="dacot-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
