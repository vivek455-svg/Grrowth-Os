import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { demoMode, supabaseConfigured } from "@/lib/env";

export const metadata = { title: "Setup required" };

/** Shown when neither Supabase auth nor the local demo mode is configured. */
export default async function SetupPage() {
  await connection(); // configuration is read at request time, not build time
  if (supabaseConfigured()) redirect("/login");
  if (demoMode()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Finish configuring Growth OS</CardTitle>
          <CardDescription>Authentication isn't configured yet.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            For production, set <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>, <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{" "}
            <code className="font-mono text-xs">DATABASE_URL</code>, then apply the migrations in <code className="font-mono text-xs">supabase/migrations</code>.
          </p>
          <p>
            For a local demo with sample data, set <code className="font-mono text-xs">DEMO_MODE=true</code> with a local Postgres <code className="font-mono text-xs">DATABASE_URL</code> and run{" "}
            <code className="font-mono text-xs">npm run db:reset-local</code>. Demo mode is ignored whenever Supabase is configured.
          </p>
          <p className="text-muted-foreground">See README.md for the full guide.</p>
        </CardContent>
      </Card>
    </main>
  );
}
