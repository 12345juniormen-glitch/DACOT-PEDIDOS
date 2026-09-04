import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { KeyRound } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useDocumentTitle } from "@/hooks/use-document-title";

const ROLE_LABEL = { admin: "Administrador", manager: "Gerente", waiter: "Atendimento", kitchen: "Cozinha" };

export default function MyProfilePage() {
  useDocumentTitle("Meu Perfil");
  const { user } = useAuth();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900 mb-6">Meu Perfil</h1>
      <div className="bg-white border rounded-lg p-6 space-y-4">
        <Row label="Nome" value={user?.name} />
        <Row label="Email" value={user?.email} />
        <Row label="Papel" value={ROLE_LABEL[user?.role] || user?.role} />
        <div className="pt-4 border-t">
          <Link to="/mudar-senha"><Button variant="outline" data-testid="go-change-password"><KeyRound className="w-4 h-4 mr-1.5" /> Alterar minha senha</Button></Link>
        </div>
      </div>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="grid grid-cols-3 gap-4 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="col-span-2 text-slate-800">{value || "—"}</div>
    </div>
  );
}
