// One-off maintenance script: backfills `updatedAt` on SpriteVersion documents or removes orphan versions.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import Sprite from "../models/Sprite.js";
import SpriteVersion from "../models/SpriteVersion.js";

async function backfillUpdatedAt() {
  void SpriteVersion.schema;

  const missing = await SpriteVersion.find(
    {
      $or: [{ updatedAt: { $exists: false } }, { updatedAt: null }],
    },
    { _id: 1, createdAt: 1 },
  ).lean();

  if (missing.length === 0) {
    console.log(
      "[backfill] All sprite_versions already have an updatedAt. Nothing to do.",
    );
    return;
  }

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
}

async function cleanupOrphans() {
  const bundles = await Sprite.find({}, { _id: 1 }).lean();
  const liveIds = new Set<string>(
    bundles.map((b) => String((b as { _id: unknown })._id)),
  );

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
    console.log(
      "[cleanup] No orphan sprite_versions found. Database is clean.",
    );
    return;
  }

  const result = await SpriteVersion.deleteMany({ _id: { $in: orphanIds } });
  console.log(
    `[cleanup] Removed ${result.deletedCount ?? 0} orphan sprite_version ` +
      `row(s) (out of ${orphanIds.length} candidate(s)).`,
  );
}

async function main() {
  const task =
    process.argv[2] === "cleanup-orphans"
      ? "cleanup-orphans"
      : "backfill-version-updated-at";

  await connectDb();

  try {
    if (task === "cleanup-orphans") {
      await cleanupOrphans();
    } else {
      await backfillUpdatedAt();
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (err) => {
  console.error("[maintenance] Failed:", err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
