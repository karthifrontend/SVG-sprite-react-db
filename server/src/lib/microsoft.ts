// Verifies Microsoft Entra ID (v2.0) id_tokens using the tenant JWKS, and exchanges
// authorization codes for tokens using the OAuth2 authorization-code flow with PKCE.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// Shape of the Microsoft v2.0 token-endpoint response.
export type MicrosoftTokenResponse = {
  token_type: string;
  expires_in: number;
  access_token: string;
  id_token: string;
  refresh_token?: string;
  scope?: string;
};

export type MicrosoftIdTokenClaims = {
  sub: string;
  oid: string;
  tid: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  picture?: string;
};

type MicrosoftJwksCache = Map<string, ReturnType<typeof createRemoteJWKSet>>;
type MicrosoftJwksGlobal = typeof globalThis & {
  _microsoftJwksCache?: MicrosoftJwksCache;
};
const globalForMicrosoft = globalThis as MicrosoftJwksGlobal;

// Returns a JWKS resolver for the given tenant. Cached per-tenant on globalThis so hot reloads (tsx watch) don't re-fetch the keys every request.
function jwksFor(tenant: string): ReturnType<typeof createRemoteJWKSet> {
  if (!globalForMicrosoft._microsoftJwksCache) {
    globalForMicrosoft._microsoftJwksCache = new Map();
  }
  const cache = globalForMicrosoft._microsoftJwksCache;
  const existing = cache.get(tenant);
  if (existing) return existing;
  // "common" is the multitenant token issuer. For a single-tenant app we'd use the tenant guid instead — the discovery URL works for either.
  const url = new URL(
    `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
  );
  const jwks = createRemoteJWKSet(url);
  cache.set(tenant, jwks);
  return jwks;
}

function isMicrosoftClaims(
  payload: JWTPayload,
): payload is MicrosoftIdTokenClaims & JWTPayload {
  const p = payload as Record<string, unknown>;
  return (
    typeof p.sub === "string" &&
    typeof p.oid === "string" &&
    typeof p.tid === "string" &&
    typeof p.email === "string"
  );
}

// Verifies the Microsoft id_token signature, issuer, audience, and expiry.
// Throws on any failure with a message the auth route can surface to the client.
export async function verifyMicrosoftIdToken(
  idToken: string,
  expectedAudience: string,
  expectedTenant: string,
): Promise<MicrosoftIdTokenClaims> {
  if (!idToken) throw new Error("Missing Microsoft id_token.");
  if (!expectedAudience) {
    throw new Error("Server is not configured with a Microsoft client id.");
  }
  if (!expectedTenant) {
    throw new Error("Server is not configured with a Microsoft tenant id.");
  }

  // v2.0 issuer is `https://login.microsoftonline.com/{tenant}/v2.0`. We accept the
  // tenant id OR the literal `common` for multitenant apps.
  const acceptableIssuers = [
    `https://login.microsoftonline.com/${expectedTenant}/v2.0`,
    "https://login.microsoftonline.com/common/v2.0",
  ];

  const { payload } = await jwtVerify(idToken, jwksFor(expectedTenant), {
    issuer: acceptableIssuers,
    audience: expectedAudience,
  });

  if (!isMicrosoftClaims(payload)) {
    throw new Error("Microsoft id_token is missing required claims.");
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new Error("Microsoft id_token has expired.");
  }

  return {
    sub: payload.sub,
    oid: payload.oid,
    tid: payload.tid,
    email: payload.email,
    // Microsoft v2.0 id_tokens only carry `email_verified` for personal accounts.
    email_verified:
      typeof payload.email_verified === "boolean"
        ? payload.email_verified
        : true,
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    ...(typeof payload.preferred_username === "string"
      ? { preferred_username: payload.preferred_username }
      : {}),
    ...(typeof payload.picture === "string" ? { picture: payload.picture } : {}),
  };
}

// Exchanges an authorization code (from the MSAL.js popup) for tokens. 
export async function exchangeMicrosoftCodeForTokens(args: {
  tenant: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<MicrosoftTokenResponse> {
  const url = `https://login.microsoftonline.com/${args.tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
    code_verifier: args.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri,
    scope: "openid profile email offline_access",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    // Microsoft returns `{ error, error_description, error_codes, ... }` on failure.
    let detail = `Microsoft token endpoint returned ${res.status}`;
    try {
      const errBody = (await res.json()) as {
        error?: string;
        error_description?: string;
      };
      if (errBody.error_description) {
        detail = errBody.error_description;
      } else if (errBody.error) {
        detail = errBody.error;
      }
    } catch {
      // fall through with the status-only message
    }
    throw new Error(detail);
  }

  return (await res.json()) as MicrosoftTokenResponse;
}
