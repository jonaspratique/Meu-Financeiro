import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Wallet className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Meu Financeiro</h1>
            <p className="mt-1 text-sm text-muted-foreground">Entre para acessar suas finanças</p>
          </div>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">Acesso privado. Não há cadastro público.</p>
      </div>
    </main>
  );
}
