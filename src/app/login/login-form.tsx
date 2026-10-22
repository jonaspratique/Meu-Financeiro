"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { signIn } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <Card className="p-6">
      <form action={action} className="grid gap-4">
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {state?.error && (
          <p className="rounded-lg bg-negative-soft px-3 py-2 text-sm text-negative" role="alert">
            {state.error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </Card>
  );
}
