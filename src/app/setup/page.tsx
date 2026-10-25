import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { demoMode } from "@/lib/env";
import { setupStatus } from "@/server/setup";

export const metadata = { title: "Setup required" };

/** Lists what's missing or misconfigured. Shows variable names and fixes only, never values. */
export default async function SetupPage() {
  await connection(); // configuration is read at request time, not build time
  const status = await setupStatus();
  if (status.ok) redirect(demoMode() ? "/" : "/login");
  const count = status.problems.length;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Finish setting up Growth OS</CardTitle>
          <CardDescription>
            {count === 1 ? "One setting needs" : `${count} settings need`} attention before anyone can sign in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <ul className="divide-y rounded-md border">
            {status.problems.map((p, i) => (
              <li key={`${p.key}-${i}`} className="flex gap-3 p-3">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <div className="min-w-0 space-y-1">
                  <code className="font-mono text-xs font-medium wrap-anywhere">{p.key}</code>
                  <p className="text-muted-foreground">{p.message}</p>
                </div>
              </li>
            ))}
          </ul>

          <Separator />

          <div className="space-y-2">
            <p className="font-medium">How to fix it on Vercel</p>
            <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
              <li>Open your project → Settings → Environment Variables, and set the variables above.</li>
              <li>
                Redeploy (Deployments → ⋯ → Redeploy). Changed variables only apply to new deployments.
              </li>
              <li>
                In Supabase → Authentication → URL Configuration, set the Site URL to{" "}
                <code className="font-mono text-xs wrap-anywhere text-foreground">{status.appUrl}</code> and add{" "}
                <code className="font-mono text-xs wrap-anywhere text-foreground">{status.appUrl}/auth/callback</code> to Redirect URLs.
              </li>
            </ol>
            <p className="text-muted-foreground">
              Running locally instead? Set <code className="font-mono text-xs">DEMO_MODE=true</code> with a local Postgres and run{" "}
              <code className="font-mono text-xs">npm run db:reset-local</code>. The README has the full guide.
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button asChild size="sm" variant="outline">
            <Link href="/setup" prefetch={false}>
              Check again
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
