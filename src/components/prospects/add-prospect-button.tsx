"use client";

import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/app/shell-context";

export function AddProspectButton() {
  const { openNewProspect } = useShell();
  return (
    <Button size="sm" onClick={openNewProspect}>
      <UserPlus /> Add prospect
    </Button>
  );
}
