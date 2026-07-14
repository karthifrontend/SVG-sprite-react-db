// One-time backfill: assign every existing sprite to a "system"
// user so the new required `ownerId` field has a value. New writes
// will stamp the real Google-authenticated user instead.
//
// Run with:  npm run backfill:owner
// (after `npm install` and a valid MONGODB_URI in server/.env)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../db.js";
import User from "../models/User.js";
import Sprite from "../models/Sprite.js";

const SYSTEM_USER_ID = "system";
const SYSTEM_USER_EMAIL = "system@local.invalid";

async function main() {
  await connectDb();

  // Upsert the system user once. We mark the email as not verified
  // so it's obvious these are not real logins.
  const systemUser = await User.findOneAndUpdate(
    { provider: "google", providerId: SYSTEM_USER_ID },
    {
      $set: {
        email: SYSTEM_USER_EMAIL,
        emailVerified: false,
        displayName: "Legacy system library",
        picture: null,
        lastLoginAt: new Date(),
      },
      $setOnInsert: { provider: "google", providerId: SYSTEM_USER_ID },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Only touch documents that don't have an ownerId set yet.
  const result = await Sprite.updateMany(
    { ownerId: { $exists: false } },
    {
      $set: {
        ownerId: systemUser._id,
        ownerEmail: SYSTEM_USER_EMAIL,
      },
    }
  );

  console.log(
    `[backfill] Marked ${result.modifiedCount ?? 0} sprite(s) as owned by the system user (${String(
      systemUser._id
    )}).`
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[backfill] Failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
