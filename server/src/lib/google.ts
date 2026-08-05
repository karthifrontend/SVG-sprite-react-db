// Validates the JWT returned from the client sign-in flow using Google's JWKS.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

// Returns a function that fetches the JWKS on demand and caches the keys.
const jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);

// Type definition for the claims returned in a Google id_token.
export type GoogleIdTokenClaims = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
};

// Type guard to check if the payload has the required Google claims.
function isGoogleClaims(payload: JWTPayload): payload is GoogleIdTokenClaims & JWTPayload {
  return typeof payload.sub === "string" && typeof payload.email === "string";
}

// Verifies the Google id_token and returns the claims if valid.
export async function verifyGoogleIdToken(
  credential: string,
  expectedAudience: string
): Promise<GoogleIdTokenClaims> {
  if (!credential) {
    throw new Error("Missing Google id_token.");
  }
  if (!expectedAudience) {
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
