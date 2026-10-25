"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/app/shell-context";

export function NewPostButton({ label = "New post", variant = "default" }: { label?: string; variant?: "default" | "outline" }) {
  const { openNewPost } = useShell();
  return (
    <Button size="sm" variant={variant} onClick={() => openNewPost()}>
      <Plus /> {label}
    </Button>
  );
}
