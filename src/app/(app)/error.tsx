"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <EmptyState icon={AlertTriangle} title="Something went wrong" description="This page couldn't load. Your data is safe — try again. On a new deployment, the setup check shows any missing configuration.">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => retry()}>
          Try again
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/setup">Check setup</Link>
        </Button>
      </div>
    </EmptyState>
  );
}
