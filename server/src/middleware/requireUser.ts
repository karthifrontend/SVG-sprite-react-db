// requireUser middleware. Reads the bearer token from the
// `Authorization` header, verifies the session JWT, and loads the
// matching User document onto `req.user`. Routes that need an
// authenticated user mount this middleware; routes that need a
// specific role or ownership check do that after the user is loaded.
import type { NextFunction, Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import { verifySession } from "../lib/session.js";
import User, { type UserDoc } from "../models/User.js";

// The session user shape we attach to requests. We type it as the
// runtime Mongoose hydrated document so `_id` is available without
// the InferSchemaType noise.
export type SessionUser = HydratedDocument<UserDoc>;

// Augment Express's Request so handlers can read `req.user`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const token = header.slice("bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const claims = await verifySession(token);
    const user = await User.findById(claims.sub);
    if (!user) {
      res.status(401).json({ error: "Session user no longer exists." });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid session.";
    res.status(401).json({ error: message });
  }
}
