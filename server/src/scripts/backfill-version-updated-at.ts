// One-off backfill: every `sprite_versions` row currently lacks
// an `updatedAt` field, because the original schema was set to
// `timestamps: { createdAt: true, updatedAt: false }`. The new
// schema enables `updatedAt: true` so each version row tracks
// when it was last edited, but existing rows still need the
// field populated.
//
// We set `updatedAt = createdAt` for every row that doesn't
// already have one. This is a reasonable approximation: a version
// row that has never been touched since its `createdAt` was set
// is exactly the case we want to represent as "last edited = first
// saved". Rows that have been edited in the past (between
// `createdAt` and now) will show a slightly stale `updatedAt`,
// but that's strictly better than `undefined`.
//
// After this script runs once, future edits (PUT /:id) will
// refresh `updatedAt` automatically via the schema hook.
//
// Run with:  npm run backfill:version-updated-at
// (after `npm install` and a valid MONGODB_URI in server/.env)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../db.js";
import SpriteVersion from "../models/SpriteVersion.js";

async function main() {
  await connectDb();

  // Touch the schema so Mongoose's timestamp hooks are wired up
  // before we read. Without this, the field projection below
  // wouldn't see `updatedAt` on the result.
  void SpriteVersion.schema;

  // Find every version that doesn't have an `updatedAt` set.
  // We use a `null` / `$exists: false` filter so we don't
  // overwrite rows that have already been edited after the
  // schema change went live.
  const missing = await SpriteVersion.find(
    {
      $or: [
        { updatedAt: { $exists: false } },
        { updatedAt: null },
      ],
    },
    { _id: 1, createdAt: 1 },
  ).lean();

  if (missing.length === 0) {
    console.log(
      "[backfill] All sprite_versions already have an updatedAt. Nothing to do.",
    );
    await mongoose.disconnect();
    return;
  }

  // Bulk-write `updatedAt = createdAt` (or `now` for the rare
  // row where `createdAt` is also missing — which shouldn't
  // happen, but we guard against it so the script never blocks
  // progress). `bulkWrite` is one round-trip, so even tens of
  // thousands of rows finish in well under a second.
  const ops = missing.map((doc) => {
    const fallback = new Date();
    const createdAt = (doc as { createdAt?: Date }).createdAt ?? fallback;
    return {
      updateOne: {
        filter: { _id: (doc as { _id: unknown })._id },
        update: { $set: { updatedAt: createdAt } },
      },
    };
  });

  const result = await SpriteVersion.bulkWrite(ops, { ordered: false });
  console.log(
    `[backfill] Populated updatedAt on ${result.modifiedCount ?? 0} ` +
      `sprite_version row(s) (out of ${missing.length} candidate(s)).`,
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
