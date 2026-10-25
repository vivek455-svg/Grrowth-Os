import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/onboarding/login-form";
import { getSessionUser } from "@/server/auth";
import { env, supabaseConfigured } from "@/lib/env";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await connection(); // configuration is read at request time, not build time
  if (!supabaseConfigured()) redirect("/setup");
  if (await getSessionUser()) redirect("/");
  const sp = await searchParams;
  const e = env();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <LoginForm url={e.NEXT_PUBLIC_SUPABASE_URL!} anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY!} error={typeof sp.error === "string" ? sp.error : null} />
    </main>
  );
}
