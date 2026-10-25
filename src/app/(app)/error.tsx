"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState icon={AlertTriangle} title="Something went wrong" description="This page couldn't load. Your data is safe — try again, and if it keeps happening, check the server logs.">
      <Button size="sm" onClick={reset}>Try again</Button>
    </EmptyState>
  );
}
