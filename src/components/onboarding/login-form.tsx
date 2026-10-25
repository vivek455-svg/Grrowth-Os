"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

export function LoginForm({ url, anonKey, error }: { url: string; anonKey: string; error: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(error ? { kind: "error", text: error } : null);
  const [pending, setPending] = useState(false);
  const supabase = createBrowserClient(url, anonKey);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const redirectTo = `${window.location.origin}/auth/callback`;
    const res =
      mode === "magic"
        ? await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
        : mode === "signup"
          ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
          : await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (res.error) return setMsg({ kind: "error", text: res.error.message });
    if (mode === "signin") return router.push("/");
    setMsg({ kind: "info", text: "Check your email for a link to continue." });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex size-8 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">GO</div>
        <CardTitle>{mode === "signup" ? "Create your workspace" : "Sign in to Growth OS"}</CardTitle>
        <CardDescription>{mode === "magic" ? "We'll email you a sign-in link." : "Use your email and password."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup className="gap-4">
            {msg && (
              <Alert variant={msg.kind === "error" ? "destructive" : "default"}>
                <AlertDescription>{msg.text}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {mode !== "magic" && (
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} {mode === "signup" ? "Create account" : mode === "magic" ? "Send link" : "Sign in"}
            </Button>
            <div className="flex justify-between text-xs text-muted-foreground">
              <button type="button" className="hover:text-foreground hover:underline" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
                {mode === "signup" ? "Have an account? Sign in" : "Create an account"}
              </button>
              <button type="button" className="hover:text-foreground hover:underline" onClick={() => setMode(mode === "magic" ? "signin" : "magic")}>
                {mode === "magic" ? "Use password" : "Email me a link"}
              </button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
