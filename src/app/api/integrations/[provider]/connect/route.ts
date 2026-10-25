import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth";
import { isOAuthProvider, startOAuth, IntegrationError } from "@/server/integrations/oauth";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/integrations/[provider]/connect">) {
  const { provider } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!isOAuthProvider(provider)) return NextResponse.redirect(new URL("/integrations?error=unknown_provider", request.url));
  if (user.isDemo) return NextResponse.redirect(new URL("/integrations?error=demo", request.url));
  try {
    return NextResponse.redirect(await startOAuth(user.id, provider));
  } catch (e) {
    const msg = e instanceof IntegrationError ? e.message : "Couldn't start the connection.";
    return NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(msg)}`, request.url));
  }
}
