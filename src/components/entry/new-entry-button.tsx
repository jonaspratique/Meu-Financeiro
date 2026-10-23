"use client";

import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useEntryDialog, type EntryKind } from "./entry-provider";

export function NewEntryButton({
  kind,
  cardId,
  label = "Novo lançamento",
  ...props
}: ButtonProps & { kind?: EntryKind; cardId?: string; label?: string }) {
  const { openNew, openDraft } = useEntryDialog();
  return (
    <Button onClick={() => (cardId ? openDraft({ kind: "expense", cardId }) : openNew(kind))} {...props}>
      <Plus /> {label}
    </Button>
  );
}
