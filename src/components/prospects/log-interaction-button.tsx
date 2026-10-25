"use client";

import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/app/shell-context";

export function LogInteractionButton() {
  const { openLogInteraction } = useShell();
  return (
    <Button size="sm" onClick={() => openLogInteraction()}>
      <NotebookPen /> Log interaction
    </Button>
  );
}
