// requireUser middleware. Verifies the session token, loads the User, and attaches it to the request (or 401s).
import type { NextFunction, Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import { verifySession } from "../lib/session.js";
import User, { type UserDoc } from "../models/User.js";

export type SessionUser = HydratedDocument<UserDoc>;

declare global {
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
