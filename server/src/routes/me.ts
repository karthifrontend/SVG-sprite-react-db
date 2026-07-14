// /api/auth/me — returns the user attached to the current session
// token. Used by the client on page load to rehydrate the signed-in
// user from `localStorage` without trusting the client-stored data.
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
