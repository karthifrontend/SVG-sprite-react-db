// Google id_token verification.
//
// The client uses Google Identity Services (GIS) and posts the raw
// `credential` (a JWT id_token) to /api/auth/google. We must verify
// it against Google's signing keys (fetched from the JWKS endpoint
// and cached) and check the standard claims (`iss`, `aud`, `exp`).
// The library `jose` handles all of this for us.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

// `createRemoteJWKSet` returns a function that fetches the JWKS on
// demand and caches the keys; we instantiate it once at module load.
const jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);

export type GoogleIdTokenClaims = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
};

function isGoogleClaims(payload: JWTPayload): payload is GoogleIdTokenClaims & JWTPayload {
  return typeof payload.sub === "string" && typeof payload.email === "string";
}

export async function verifyGoogleIdToken(
  credential: string,
  expectedAudience: string
): Promise<GoogleIdTokenClaims> {
  if (!credential) {
    throw new Error("Missing Google id_token.");
  }
  if (!expectedAudience) {
    // Defensive: an empty audience means anyone could sign tokens
    // for us, so refuse to verify at all.
    throw new Error("Server is not configured with a Google client id.");
  }

  const { payload } = await jwtVerify(credential, jwks, {
    issuer: GOOGLE_ISSUER,
    audience: expectedAudience,
  });

  if (!isGoogleClaims(payload)) {
    throw new Error("Google id_token is missing required claims.");
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    throw new Error("Google id_token has expired.");
  }
  if (!payload.email_verified) {
    // We only want to trust verified Google addresses. A user can
    // re-run the flow once Google confirms their address.
    throw new Error("Google account email is not verified.");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: Boolean(payload.email_verified),
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    ...(typeof payload.picture === "string" ? { picture: payload.picture } : {}),
  };
}
