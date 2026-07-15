// /api/auth — Google + Microsoft (placeholder) + Demo sign-in.
//
// The client posts the raw Google `credential` JWT returned by
// Google Identity Services. We verify the token, upsert a User
// document, and respond with a short-lived session token the client
// can attach to subsequent API calls.
//
// The demo endpoint provisions a built-in "demo" account so users
// can try the app without a real OAuth flow. It is scoped to a
// single shared user so anyone who clicks "Continue as Demo"
// shares one library; the user is still a separate `User` doc with
// its own `ownerId`, distinct from Google / Microsoft / system
// users.
//
// Microsoft sign-in is intentionally not implemented server-side
// yet; the route returns 501 so the client gets a clear signal
// instead of a 404.
import { Router, type Request, type Response } from "express";
import type { HydratedDocument } from "mongoose";
import { verifyGoogleIdToken } from "../lib/google.js";
import { signSession } from "../lib/session.js";
import { ensureConnected } from "../db.js";
import User, { type UserDoc } from "../models/User.js";

const router = Router();

type LoginBody = {
  credential?: unknown;
};

// Built-in demo account. The `providerId` is a fixed sentinel so
// the upsert always lands on the same document regardless of how
// many people click the button.
const DEMO_PROVIDER_ID = "demo";
const DEMO_EMAIL = "demo@svg-compiler.local";
const DEMO_DISPLAY_NAME = "Demo User";

function asString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

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

function notConnectedResponse(res: Response) {
  return res.status(503).json({
    error:
      "Database is not connected. Check Atlas Network Access and the MONGODB_URI credentials.",
  });
}

/**
 * POST /api/auth/google
 *
 * Body: { credential: string }  // the Google id_token from GIS
 * Response: { user, token }
 *
 * The token is a short-lived JWT the client attaches to subsequent
 * API calls as `Authorization: Bearer <token>`.
 */
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

  let claims;
  try {
    claims = await verifyGoogleIdToken(credential, expectedAudience);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google sign-in failed.";
    return res.status(401).json({ error: message });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const now = new Date();
    // Upsert by (provider, providerId) so a returning user is
    // matched deterministically. Profile fields are refreshed on
    // every login so the display name and picture stay current.
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
      }
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

/**
 * POST /api/auth/demo
 *
 * Issues a session for the built-in demo account. The same single
 * `User` document is upserted on every call so everyone using the
 * demo flow shares one library. The user is still scoped by its
 * own `ownerId`, which is distinct from real Google / Microsoft
 * accounts, so demo saves never leak into a real user's library.
 *
 * No request body is required.
 */
router.post("/demo", async (_req: Request, res: Response) => {
  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const now = new Date();
    const user = await User.findOneAndUpdate(
      { provider: "demo", providerId: DEMO_PROVIDER_ID },
      {
        $set: {
          email: DEMO_EMAIL,
          emailVerified: true,
          displayName: DEMO_DISPLAY_NAME,
          picture: null,
          lastLoginAt: now,
        },
        $setOnInsert: {
          provider: "demo",
          providerId: DEMO_PROVIDER_ID,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      }
    );

    const token = await signSession({
      sub: String(user._id),
      email: user.email,
      provider: "demo",
      providerId: user.providerId,
    });

    return res.json({ user: publicUser(user), token });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /api/auth/microsoft
 *
 * Placeholder for Microsoft (Entra ID / MSAL) sign-in. The backend
 * MSAL flow is intentionally not wired up yet, so this route
 * returns 501 with a clear message. The client surfaces this in
 * the login modal so users get feedback instead of a generic
 * network error.
 */
router.post("/microsoft", (_req: Request, res: Response) => {
  return res.status(501).json({
    error:
      "Microsoft sign-in is not configured on the server yet. " +
      "Please use Google or the Demo account for now.",
  });
});

export default router;
