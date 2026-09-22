import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

// Supports the two columns normally exported by address-book tools: nome,name
// and telefone,phone. It is intentionally a file import, not a WhatsApp login.
function splitCsvLine(line, separator) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
    } else if (char === separator && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseContactsCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("O arquivo precisa ter cabeçalho e ao menos um contato.");
  const separator = lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], separator).map((header) => header.trim().toLowerCase());
  const nameIndex = headers.findIndex((header) => ["nome", "name", "nome completo", "full name"].includes(header));
  const phoneIndex = headers.findIndex((header) => ["telefone", "phone", "celular", "mobile", "número", "numero"].includes(header));
  if (phoneIndex < 0) throw new Error("Não encontramos a coluna Telefone ou Phone.");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, separator);
    return { name: nameIndex >= 0 ? cells[nameIndex] || "" : "", phone: cells[phoneIndex] || "" };
  }).filter((contact) => contact.phone.trim());
}

export function CustomerImportDialog({ open, onOpenChange, onImported }) {
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!file) return toast.error("Selecione um arquivo CSV.");
    setSaving(true);
    try {
      const contacts = parseContactsCsv(await file.text());
      if (!contacts.length) throw new Error("Nenhum telefone foi encontrado no arquivo.");
      const { data } = await api.post("/customers/import", { contacts });
      toast.success(`${data.created} cliente(s) importado(s).`);
      if (data.already_exists) toast.info(`${data.already_exists} contato(s) já existiam e foram ignorados.`);
      if (data.invalid) toast.warning(`${data.invalid} contato(s) tinham telefone inválido.`);
      setFile(null);
      onOpenChange(false);
      onImported?.();
    } catch (error) {
      toast.error(error?.message || formatApiError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>
            Envie um CSV exportado da agenda do restaurante. O DACOT não acessa nem faz login no WhatsApp; contatos repetidos por telefone não serão criados.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-dashed p-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 text-center text-sm">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span>{file?.name || "Selecionar arquivo CSV"}</span>
            <span className="text-xs text-muted-foreground">Colunas aceitas: Nome e Telefone.</span>
            <input className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} data-testid="customer-import-file" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} data-testid="customer-import-submit">
            {saving ? "Importando..." : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
