"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">This page couldn't load</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        A server error occurred. If this is a new deployment, the setup check lists any missing configuration.
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => retry()}>
          Try again
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/setup">Check setup</Link>
        </Button>
      </div>
      {digest && <p className="font-mono text-xs text-muted-foreground">Error {digest}</p>}
    </main>
  );
}
