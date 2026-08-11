// Verifies Google and Microsoft ID tokens, upserts users, and issues session cookies/JWTs.
import { Router, type Request, type Response } from "express";
import type { HydratedDocument } from "mongoose";
import { verifyGoogleIdToken } from "../lib/google.js";
import { verifyMicrosoftIdToken } from "../lib/microsoft.js";
import { signSession } from "../lib/session.js";
import { ensureConnected } from "../config/db.js";
import User, { type UserDoc } from "../models/User.js";

const router = Router();

type LoginBody = {
  credential?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

// Returns a public-facing user object with sensitive fields omitted. This is the shape of the `user` property in the response to the client after login.
function publicUser(user: HydratedDocument<UserDoc>) {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    picture: user.picture ?? null,
    emailVerified: user.emailVerified,
    provider: user.provider,
    lastLoginAt: user.lastLoginAt,
  };
}

// Returns a 503 Service Unavailable response with a message about the database connection.
function notConnectedResponse(res: Response) {
  return res.status(503).json({
    error:
      "Database is not connected. Check Atlas Network Access and the MONGODB_URI credentials.",
  });
}

// POST method for Google sign-in.
router.post("/google", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as LoginBody;
  const credential = asString(body.credential);
  if (!credential) {
    return res.status(400).json({ error: "Google credential is required." });
  }

  const expectedAudience = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  if (!expectedAudience) {
    return res.status(500).json({
      error:
        "Server is missing GOOGLE_CLIENT_ID. Add it to server/.env to enable Google sign-in.",
    });
  }
  // Verify the Google ID token and extract the claims (user info) from it.
  let claims;
  try {
    claims = await verifyGoogleIdToken(credential, expectedAudience);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Google sign-in failed.";
    return res.status(401).json({ error: message });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }
  // Upsert the user in the database and issue a session token.
  try {
    const now = new Date();
    const user = await User.findOneAndUpdate(
      { provider: "google", providerId: claims.sub },
      {
        $set: {
          email: claims.email.toLowerCase(),
          emailVerified: claims.email_verified,
          displayName: claims.name ?? claims.email,
          picture: claims.picture ?? null,
          lastLoginAt: now,
        },
        $setOnInsert: {
          provider: "google",
          providerId: claims.sub,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    );

    const token = await signSession({
      sub: String(user._id),
      email: user.email,
      provider: "google",
      providerId: user.providerId,
    });

    return res.json({ user: publicUser(user), token });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

// POST method for Microsoft sign-in. The MSAL.js popup on the client sends the id_token it received from the Microsoft account chooser.
router.post("/microsoft", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { idToken?: unknown };
  const idToken = asString(body.idToken);
  if (!idToken) {
    return res.status(400).json({
      error: "Microsoft sign-in requires `idToken`.",
    });
  }

  const tenant = (process.env.MS_TENANT_ID ?? "").trim() || "common";
  const clientId = (process.env.MS_CLIENT_ID ?? "").trim();
  // MS_CLIENT_SECRET is reserved for future server-side flows (e.g. refresh token exchange).
  if (!clientId) {
    return res.status(500).json({
      error:
        "Server is missing MS_CLIENT_ID. Add it to server/.env to enable Microsoft sign-in.",
    });
  }

  // Verify the id_token against the tenant JWKS, audience, and issuer.
  let claims;
  try {
    claims = await verifyMicrosoftIdToken(idToken, clientId, tenant);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Microsoft id_token verification failed.";
    return res.status(401).json({ error: message });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  // Upsert keyed on (provider, providerId). `oid` is the immutable object id in Entra ID and is the right cross-tenant-unique key. 
  const providerId = claims.oid || claims.sub;
  // Microsoft doesn't always return `name` for work/school accounts; fall back to `preferred_username` (typically the UPN) and finally the email local part.
  const displayName =
    claims.name ||
    claims.preferred_username ||
    claims.email.split("@")[0] ||
    claims.email;

  try {
    const now = new Date();
    const user = await User.findOneAndUpdate(
      { provider: "microsoft", providerId },
      {
        $set: {
          email: claims.email.toLowerCase(),
          emailVerified: Boolean(claims.email_verified),
          displayName,
          picture: claims.picture ?? null,
          lastLoginAt: now,
        },
        $setOnInsert: {
          provider: "microsoft",
          providerId,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    );

    const token = await signSession({
      sub: String(user._id),
      email: user.email,
      provider: "microsoft",
      providerId: user.providerId,
    });

    return res.json({ user: publicUser(user), token });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

export default router;
