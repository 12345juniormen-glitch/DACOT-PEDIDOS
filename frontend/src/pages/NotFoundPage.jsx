import { Link } from "react-router-dom";
import { UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function NotFoundPage() {
  useDocumentTitle("Página não encontrada");
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-center px-4">
      <UtensilsCrossed className="w-10 h-10 text-orange-500" />
      <h1 className="text-3xl font-display font-bold text-foreground">Página não encontrada</h1>
      <p className="text-sm text-muted-foreground max-w-sm">
        O endereço acessado não existe ou foi movido.
      </p>
      <Button asChild>
        <Link to="/">Voltar ao início</Link>
      </Button>
    </div>
  );
}
