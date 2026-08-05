// Verifies the session token, loads the User, and attaches it to the request (Auth, error, and validation rules).
import type { NextFunction, Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import { verifySession } from "../lib/session.js";
import User, { type UserDoc } from "../models/User.js";

// User object attached to the request after successful authentication.
export type SessionUser = HydratedDocument<UserDoc>;

// Extending the Express Request interface to include the user property.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// Returns a function that requires a valid session token and loads the User into the request.
export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Extract the Authorization header from the request.
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  // Extract the token from the Authorization header.
  const token = header.slice("bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // Verify the session token and load the user from the database.
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
