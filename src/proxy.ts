import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on navigation and redirects signed-out users
 * to /login. In demo mode (no Supabase env) it is a no-op; pages still call requireUser().
 */
export async function proxy(request: NextRequest) {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } = env();
  if (!url || !key) return NextResponse.next();

  const path = request.nextUrl.pathname;
  const isPublic = ["/login", "/auth", "/setup", "/api/cron"].some((p) => path.startsWith(p));
  let response = NextResponse.next({ request });
  let signedIn = false;
  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } catch {
    // Misconfigured Supabase settings: /setup explains what to fix.
    if (!isPublic) return redirectTo(request, "/setup");
    return response;
  }
  if (!signedIn && !isPublic) return redirectTo(request, "/login");
  return response;
}

function redirectTo(request: NextRequest, pathname: string) {
  const to = request.nextUrl.clone();
  to.pathname = pathname;
  to.search = "";
  return NextResponse.redirect(to);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
