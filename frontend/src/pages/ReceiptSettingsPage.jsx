import { useEffect, useRef, useState } from "react";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

const PRESETS = [
  { id: "classic", name: "Clássico", description: "Cabeçalho centralizado e separadores tradicionais." },
  { id: "compact", name: "Compacto", description: "Menos espaço entre as informações para rolos térmicos." },
  { id: "minimal", name: "Minimalista", description: "Alinhamento à esquerda e linhas simples." },
];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export default function ReceiptSettingsPage() {
  const [settings, setSettings] = useState({ preset: "classic", logo_data_url: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    let active = true;
    api.get("/restaurant/print-settings")
      .then(({ data }) => {
        if (active) setSettings({ preset: data?.preset || "classic", logo_data_url: data?.logo_data_url || null });
      })
      .catch((error) => toast.error(formatApiError(error)))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const chooseLogo = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Escolha uma imagem PNG, JPEG ou WebP.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("A imagem deve ter no máximo 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSettings((current) => ({ ...current, logo_data_url: String(reader.result) }));
    reader.onerror = () => toast.error("Não foi possível ler a imagem.");
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/restaurant/print-settings", settings);
      setSettings({ preset: data.preset, logo_data_url: data.logo_data_url || null });
      toast.success("Configuração do comprovante salva.");
    } catch (error) {
      toast.error(formatApiError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Comprovantes"
        subtitle="Escolha um modelo para os comprovantes impressos e adicione a logo do restaurante."
        action={<Button onClick={save} disabled={loading || saving} data-testid="save-receipt-settings"><Save className="h-4 w-4" />{saving ? "Salvando…" : "Salvar configuração"}</Button>}
      />

      {loading ? <div className="py-10 text-sm text-muted-foreground">Carregando configuração…</div> : (
        <div className="space-y-8">
          <section aria-labelledby="receipt-presets-heading">
            <div className="mb-3">
              <h2 id="receipt-presets-heading" className="text-sm font-semibold text-foreground">Design do comprovante</h2>
              <p className="mt-1 text-xs text-muted-foreground">O modelo escolhido será aplicado às próximas impressões deste restaurante.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={settings.preset === preset.id}
                  onClick={() => setSettings((current) => ({ ...current, preset: preset.id }))}
                  className={`border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${settings.preset === preset.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                  data-testid={`receipt-preset-${preset.id}`}
                >
                  <div className={`mb-4 min-h-28 border bg-background p-3 ${preset.id === "minimal" ? "text-left" : "text-center"}`} aria-hidden="true">
                    <div className="mx-auto mb-2 h-5 w-14 border border-dashed border-muted-foreground/50 text-[8px] leading-5 text-muted-foreground">LOGO</div>
                    <div className="text-[9px] font-semibold tracking-wide">RESTAURANTE</div>
                    <div className="my-2 border-t border-dashed border-border" />
                    <div className="flex justify-between text-[8px] text-muted-foreground"><span>2× Produto</span><span>R$ 00,00</span></div>
                    <div className="mt-2 border-t border-border pt-1 text-[9px] font-semibold">TOTAL</div>
                  </div>
                  <span className="block text-sm font-medium text-foreground">{preset.name}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{preset.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="receipt-logo-heading" className="border-t border-border pt-6">
            <div className="mb-3">
              <h2 id="receipt-logo-heading" className="text-sm font-semibold text-foreground">Logo do restaurante</h2>
              <p className="mt-1 text-xs text-muted-foreground">PNG, JPEG ou WebP, até 2 MB. A imagem aparece no cabeçalho do comprovante.</p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-28 w-44 items-center justify-center border border-dashed border-border bg-muted/20 p-3">
                {settings.logo_data_url
                  ? <img src={settings.logo_data_url} alt="Prévia da logo do restaurante" className="max-h-full max-w-full object-contain" />
                  : <span className="text-xs text-muted-foreground">Sua logo aqui</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} className="sr-only" aria-label="Selecionar logo do restaurante" data-testid="receipt-logo-input" />
                <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4" />Selecionar imagem</Button>
                {settings.logo_data_url && <Button type="button" variant="outline" onClick={() => setSettings((current) => ({ ...current, logo_data_url: null }))}><Trash2 className="h-4 w-4" />Remover logo</Button>}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
