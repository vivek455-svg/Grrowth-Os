import "server-only";
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { asService } from "@/db/client";
import { activityLogs, integrationCredentials, integrations, oauthStates, type IntegrationProviderKey } from "@/db/schema";
import { decryptSecret, encryptSecret, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { integrationDef, LINKEDIN_API_VERSION } from "./registry";

/**
 * OAuth 2.0 authorization-code flow (with PKCE where the provider supports it).
 * State + verifier live in a server-only table, are single-use and expire after 10 minutes.
 * Tokens are AES-256-GCM encrypted and never leave the server.
 */
type OAuthProvider = "x" | "linkedin" | "gmail";

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  pkce: boolean;
  basicAuth: boolean;
  extraAuthParams?: Record<string, string>;
  account: (token: string) => Promise<{ id: string; name: string }>;
};

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status: "expired" | "error" = "error",
  ) {
    super(message);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 15000) });
  const text = await res.text();
  if (!res.ok) {
    // Never echo provider bodies to users: they can contain tokens or internal details.
    log("warn", "integration_http_error", { url: url.split("?")[0], status: res.status, body: text.slice(0, 300) });
    if (res.status === 401) throw new IntegrationError("The connection was rejected. Reconnect the integration.", "expired");
    if (res.status === 403) throw new IntegrationError("The provider denied this action. Check the granted permissions and your API plan.");
    if (res.status === 429) throw new IntegrationError("The provider is rate limiting requests. Try again later.");
    throw new IntegrationError(`The provider returned an error (HTTP ${res.status}).`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  x: {
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    revokeUrl: "https://api.x.com/2/oauth2/revoke",
    clientId: () => env().X_CLIENT_ID,
    clientSecret: () => env().X_CLIENT_SECRET,
    pkce: true,
    basicAuth: true,
    account: async (token) => {
      const r = await fetchJson<{ data: { id: string; username: string } }>("https://api.x.com/2/users/me", { headers: { authorization: `Bearer ${token}` } });
      return { id: r.data.id, name: `@${r.data.username}` };
    },
  },
  linkedin: {
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    clientId: () => env().LINKEDIN_CLIENT_ID,
    clientSecret: () => env().LINKEDIN_CLIENT_SECRET,
    pkce: false,
    basicAuth: false,
    account: async (token) => {
      const r = await fetchJson<{ sub: string; name?: string; email?: string }>("https://api.linkedin.com/v2/userinfo", {
        headers: { authorization: `Bearer ${token}`, "LinkedIn-Version": LINKEDIN_API_VERSION() },
      });
      return { id: r.sub, name: r.name ?? r.email ?? "LinkedIn member" };
    },
  },
  gmail: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    clientId: () => env().GOOGLE_CLIENT_ID,
    clientSecret: () => env().GOOGLE_CLIENT_SECRET,
    pkce: true,
    basicAuth: false,
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    account: async (token) => {
      // gmail.send can't read the Gmail profile; the OpenID userinfo endpoint gives the address.
      const u = await fetchJson<{ email: string; sub: string }>("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token}` } });
      return { id: u.email, name: u.email };
    },
  },
};

export function isOAuthProvider(p: string): p is OAuthProvider {
  return p === "x" || p === "linkedin" || p === "gmail";
}

const redirectUri = (p: OAuthProvider) => `${env().APP_URL}/api/integrations/${p}/callback`;

export async function startOAuth(userId: string, provider: OAuthProvider) {
  const cfg = PROVIDERS[provider];
  const def = integrationDef(provider)!;
  if (!cfg.clientId() || !cfg.clientSecret()) throw new IntegrationError(`${def.name} isn't configured. Set ${def.envVars.join(", ")}.`);
  if (!env().TOKEN_ENCRYPTION_KEY) throw new IntegrationError("TOKEN_ENCRYPTION_KEY must be set before connecting integrations.");
  const state = randomToken(24);
  const verifier = cfg.pkce ? randomToken(48) : null;
  await asService(async (db) => {
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
    await db.insert(oauthStates).values({ state, userId, provider, codeVerifier: verifier, expiresAt: new Date(Date.now() + 10 * 60000) });
  });
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId()!);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("scope", def.scopes.join(" "));
  url.searchParams.set("state", state);
  if (verifier) {
    url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

async function tokenRequest(provider: OAuthProvider, body: Record<string, string>) {
  const cfg = PROVIDERS[provider];
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  const params = new URLSearchParams(body);
  if (cfg.basicAuth) headers.authorization = `Basic ${Buffer.from(`${cfg.clientId()}:${cfg.clientSecret()}`).toString("base64")}`;
  else {
    params.set("client_id", cfg.clientId()!);
    params.set("client_secret", cfg.clientSecret()!);
  }
  return fetchJson<TokenResponse>(cfg.tokenUrl, { method: "POST", headers, body: params });
}

/** Validates state (single use, unexpired, same user + provider), exchanges the code, stores tokens. */
export async function completeOAuth(userId: string, provider: OAuthProvider, code: string, state: string) {
  const row = await asService(async (db) => {
    const [s] = await db.delete(oauthStates).where(eq(oauthStates.state, state)).returning();
    return s;
  });
  if (!row || row.userId !== userId || row.provider !== provider || row.expiresAt < new Date())
    throw new IntegrationError("The connection request expired or didn't match. Please try connecting again.");

  const token = await tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
    ...(row.codeVerifier ? { code_verifier: row.codeVerifier } : {}),
  });
  const account = await PROVIDERS[provider].account(token.access_token);
  const scopes = token.scope ? token.scope.split(/[ ,]+/).filter(Boolean) : integrationDef(provider)!.scopes;

  await asService(async (db) => {
    const [integration] = await db
      .insert(integrations)
      .values({ userId, provider, status: "connected", scopes, externalAccountId: account.id, externalAccountName: account.name, connectedAt: new Date(), lastError: null })
      .onConflictDoUpdate({
        target: [integrations.userId, integrations.provider],
        set: { status: "connected", scopes, externalAccountId: account.id, externalAccountName: account.name, connectedAt: new Date(), lastError: null, lastErrorAt: null },
      })
      .returning();
    const creds = {
      userId,
      accessTokenEnc: encryptSecret(token.access_token),
      refreshTokenEnc: token.refresh_token ? encryptSecret(token.refresh_token) : null,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      updatedAt: new Date(),
    };
    await db
      .insert(integrationCredentials)
      .values({ integrationId: integration!.id, ...creds })
      .onConflictDoUpdate({ target: integrationCredentials.integrationId, set: creds });
    await db.insert(activityLogs).values({ userId, action: "integration.connected", entityType: "integration", entityId: integration!.id, metadata: { provider, account: account.name } });
  });
}

/** Returns a valid access token, refreshing it when needed. Marks the integration expired on failure. */
export async function getAccessToken(userId: string, provider: OAuthProvider): Promise<{ token: string; integrationId: string; accountId: string | null; scopes: string[] }> {
  return asService(async (db) => {
    const [row] = await db
      .select({ i: integrations, c: integrationCredentials })
      .from(integrations)
      .innerJoin(integrationCredentials, eq(integrationCredentials.integrationId, integrations.id))
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)));
    if (!row || row.i.status === "disconnected") throw new IntegrationError(`${integrationDef(provider)!.name} isn't connected.`);
    const fresh = !row.c.expiresAt || row.c.expiresAt.getTime() > Date.now() + 60_000;
    if (fresh) return { token: decryptSecret(row.c.accessTokenEnc), integrationId: row.i.id, accountId: row.i.externalAccountId, scopes: row.i.scopes };
    if (!row.c.refreshTokenEnc) {
      await db.update(integrations).set({ status: "expired", lastError: "Access token expired. Reconnect.", lastErrorAt: new Date() }).where(eq(integrations.id, row.i.id));
      throw new IntegrationError("The connection expired. Reconnect the integration.", "expired");
    }
    try {
      const t = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: decryptSecret(row.c.refreshTokenEnc) });
      await db
        .update(integrationCredentials)
        .set({
          accessTokenEnc: encryptSecret(t.access_token),
          // Some providers rotate refresh tokens; keep the old one if none is returned.
          refreshTokenEnc: t.refresh_token ? encryptSecret(t.refresh_token) : row.c.refreshTokenEnc,
          expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
          updatedAt: new Date(),
        })
        .where(eq(integrationCredentials.integrationId, row.i.id));
      return { token: t.access_token, integrationId: row.i.id, accountId: row.i.externalAccountId, scopes: row.i.scopes };
    } catch (e) {
      await db.update(integrations).set({ status: "expired", lastError: "Token refresh failed. Reconnect.", lastErrorAt: new Date() }).where(eq(integrations.id, row.i.id));
      throw e instanceof IntegrationError ? new IntegrationError("The connection expired. Reconnect the integration.", "expired") : e;
    }
  });
}

/** Revokes tokens at the provider (best effort) and deletes them locally. Synced data is kept. */
export async function disconnect(userId: string, provider: IntegrationProviderKey) {
  await asService(async (db) => {
    const [row] = await db
      .select({ i: integrations, c: integrationCredentials })
      .from(integrations)
      .leftJoin(integrationCredentials, eq(integrationCredentials.integrationId, integrations.id))
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)));
    if (!row) return;
    if (row.c && isOAuthProvider(provider) && PROVIDERS[provider].revokeUrl) {
      try {
        const token = decryptSecret(row.c.refreshTokenEnc ?? row.c.accessTokenEnc);
        const cfg = PROVIDERS[provider];
        const body = new URLSearchParams({ token, ...(provider === "x" ? { client_id: cfg.clientId()! } : {}) });
        const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
        if (cfg.basicAuth) headers.authorization = `Basic ${Buffer.from(`${cfg.clientId()}:${cfg.clientSecret()}`).toString("base64")}`;
        await fetch(cfg.revokeUrl!, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
      } catch (e) {
        log("warn", "integration_revoke_failed", { provider, error: e });
      }
    }
    await db.delete(integrationCredentials).where(eq(integrationCredentials.integrationId, row.i.id));
    await db.update(integrations).set({ status: "disconnected", externalAccountId: null, externalAccountName: null, scopes: [] }).where(eq(integrations.id, row.i.id));
    await db.insert(activityLogs).values({ userId, action: "integration.disconnected", entityType: "integration", entityId: row.i.id, metadata: { provider } });
  });
}

export async function markIntegrationError(userId: string, provider: IntegrationProviderKey, e: unknown) {
  const message = e instanceof IntegrationError ? e.message : "Unexpected error";
  await asService((db) =>
    db
      .update(integrations)
      .set({ status: e instanceof IntegrationError && e.status === "expired" ? "expired" : "error", lastError: message, lastErrorAt: new Date() })
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider))),
  );
}
