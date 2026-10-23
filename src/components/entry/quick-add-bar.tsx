"use client";

import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { useEntryDialog } from "./entry-provider";

/** Barra de lançamento rápido: escreve a frase e abre o formulário já preenchido para confirmar. */
export function QuickAddBar() {
  const { openDraft } = useEntryDialog();
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    openDraft({ kind: "expense", quickText: text });
    setText("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mb-4 flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 shadow-[0_1px_2px_rgb(0_0_0/0.03)] focus-within:border-ring"
    >
      <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Lançar rápido: gastei 85 de gasolina hoje"
        aria-label="Lançamento rápido por frase"
        enterKeyHint="go"
        className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label="Interpretar e conferir"
        className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition disabled:opacity-40"
      >
        <ArrowRight className="size-4" />
      </button>
    </form>
  );
}
