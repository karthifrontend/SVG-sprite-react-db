// /api/me route. Returns the currently authenticated user (or 401) for client-side session checks.
import { Router, type Request, type Response } from "express";
import { requireUser } from "../middleware/requireUser.js";

const router = Router();

function publicUser(user: NonNullable<Request["user"]>) {
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

router.get("/", requireUser, (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return res.json({ user: publicUser(req.user) });
});

export default router;
