// One-off cleanup: drop every `sprite_versions` row whose
// `spriteId` does not point at a live `sprites` (bundle)
// document. Past code paths could leave these orphans behind if
// a bundle delete failed between the two `deleteMany` /
// `deleteOne` calls. The new `pre('deleteOne')` cascade hook on
// the Sprite schema prevents the issue going forward, but the
// data already in the database still needs scrubbing.
//
// Run with:  npm run cleanup:orphans
// (after `npm install` and a valid MONGODB_URI in server/.env)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../db.js";
import Sprite from "../models/Sprite.js";
import SpriteVersion from "../models/SpriteVersion.js";

async function main() {
  await connectDb();

  // Pull the full set of bundle ids currently in the
  // `sprites` collection. The list is small relative to the
  // version table (one entry per library, not per save) so
  // loading it into memory is fine.
  const bundles = await Sprite.find({}, { _id: 1 }).lean();
  const liveIds = new Set<string>(
    bundles.map((b) => String((b as { _id: unknown })._id)),
  );

  // Walk the version table once and collect orphan ids. We use
  // a cursor (`.lean().cursor()`) so memory stays bounded even
  // if the collection grows large.
  const orphanIds: unknown[] = [];
  const cursor = SpriteVersion.find({}, { _id: 1, spriteId: 1 })
    .lean()
    .cursor();

  for await (const doc of cursor as unknown as AsyncIterable<{
    _id: unknown;
    spriteId: unknown;
  }>) {
    const spriteId = String(doc.spriteId ?? "");
    if (!spriteId || !liveIds.has(spriteId)) {
      orphanIds.push(doc._id);
    }
  }

  if (orphanIds.length === 0) {
    console.log("[cleanup] No orphan sprite_versions found. Database is clean.");
    await mongoose.disconnect();
    return;
  }

  const result = await SpriteVersion.deleteMany({ _id: { $in: orphanIds } });
  console.log(
    `[cleanup] Removed ${result.deletedCount ?? 0} orphan sprite_version ` +
      `row(s) (out of ${orphanIds.length} candidate(s)).`,
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[cleanup] Failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
