"use client";

import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useEntryDialog, type EntryKind } from "./entry-provider";

export function NewEntryButton({ kind, label = "Novo lançamento", ...props }: ButtonProps & { kind?: EntryKind; label?: string }) {
  const { openNew } = useEntryDialog();
  return (
    <Button onClick={() => openNew(kind)} {...props}>
      <Plus /> {label}
    </Button>
  );
}
