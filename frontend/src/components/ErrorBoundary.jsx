import { Component } from "react";
import { Button } from "@/components/ui/button";

export class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console -- só telemetria de console, não há serviço de log de erros no frontend
    console.error("Erro não tratado na tela:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 flex flex-col items-center justify-center gap-3 text-center min-h-[50vh]">
          <p className="text-sm text-muted-foreground">Não foi possível exibir esta tela.</p>
          <Button size="sm" onClick={() => { window.location.href = "/"; }}>
            Voltar ao início
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
