import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth";
import { completeOAuth, isOAuthProvider, IntegrationError } from "@/server/integrations/oauth";
import { log } from "@/lib/logger";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/callback">) {
  const { provider } = await ctx.params;
  const back = (q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, request.url));
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!isOAuthProvider(provider)) return back("error=unknown_provider");
  const sp = request.nextUrl.searchParams;
  if (sp.get("error")) return back(`error=${encodeURIComponent("The connection was cancelled or denied.")}`);
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state) return back(`error=${encodeURIComponent("Missing authorization code.")}`);
  try {
    await completeOAuth(user.id, provider, code, state);
    return back(`connected=${provider}`);
  } catch (e) {
    log("warn", "oauth_callback_failed", { provider, error: e });
    return back(`error=${encodeURIComponent(e instanceof IntegrationError ? e.message : "Connection failed.")}`);
  }
}
