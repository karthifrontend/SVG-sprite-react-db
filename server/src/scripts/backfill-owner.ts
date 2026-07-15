// One-time backfill: migrate pre-existing sprite documents (which
// stored XML / symbolIds / version inline) into the new two-
// collection layout:
//
//   • One `sprites` row per (ownerId, bundleName) bundle, carrying
//     metadata only (`currentVersion`, `symbolCount`, `isPublic`).
//   • One `sprite_versions` row per legacy sprite document, with
//     the `xml` / `symbolIds` / `version` from the old document
//     and a back-reference (`spriteId`) to the new bundle row.
//
// Legacy documents that already had an `ownerId` set are claimed
// by the same user; legacy documents without an `ownerId` are
// claimed by a new built-in "system" user so the new required
// `ownerId` field has a value.
//
// Run with:  npm run backfill:owner
// (after `npm install` and a valid MONGODB_URI in server/.env)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../db.js";
import User from "../models/User.js";
import Sprite from "../models/Sprite.js";
import SpriteVersion from "../models/SpriteVersion.js";

const SYSTEM_USER_ID = "system";
const SYSTEM_USER_EMAIL = "system@local.invalid";
const SYSTEM_USER_NAME = "Legacy system library";

/**
 * Shape of a legacy sprite document sitting in the `sprites`
 * collection before the migration ran. We accept a permissive
 * shape here so the script works against any half-migrated DB.
 */
type LegacySprite = {
  _id: unknown;
  name?: string;
  bundleName?: string;
  version?: number;
  xml?: string;
  symbolIds?: string[];
  symbolCount?: number;
  ownerId?: unknown;
  ownerEmail?: string;
  isPublic?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

async function main() {
  await connectDb();

  // Upsert the system user once. We mark the email as not verified
  // so it's obvious these are not real logins.
  const systemUser = await User.findOneAndUpdate(
    { provider: "google", providerId: SYSTEM_USER_ID },
    {
      $set: {
        email: SYSTEM_USER_EMAIL,
        name: SYSTEM_USER_NAME,
        emailVerified: false,
        displayName: SYSTEM_USER_NAME,
        picture: null,
        lastLoginAt: new Date(),
      },
      $setOnInsert: { provider: "google", providerId: SYSTEM_USER_ID },
    },
    {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    }
  );

  // Pull every legacy document. We can't filter on the new
  // `currentVersion` field because old docs don't have it; the
  // presence of `xml` is the closest thing to "this is a legacy
  // document" we can use. If a previous run already migrated
  // some, those docs have no `xml` and get skipped.
  const legacyFilter = { xml: { $exists: true, $ne: null } };
  const legacyDocs = (await Sprite.find(legacyFilter).lean()) as unknown as LegacySprite[];

  let bundleCount = 0;
  let versionCount = 0;

  for (const legacy of legacyDocs) {
    const bundleName = (legacy.bundleName ?? legacy.name ?? "").trim();
    if (!bundleName) {
      // Skip malformed legacy rows — there's nothing to migrate
      // without a bundle slug.
      continue;
    }
    const ownerObjectId = legacy.ownerId ?? systemUser._id;
    const ownerEmail = (
      legacy.ownerEmail ?? SYSTEM_USER_EMAIL
    ).toLowerCase();
    const version = typeof legacy.version === "number" ? legacy.version : 1;
    const isPublic = !!legacy.isPublic;
    const xml = legacy.xml ?? "";
    const symbolIds = Array.isArray(legacy.symbolIds)
      ? legacy.symbolIds.filter((s): s is string => typeof s === "string")
      : [];
    const symbolCount =
      typeof legacy.symbolCount === "number"
        ? legacy.symbolCount
        : symbolIds.length;

    // Upsert the bundle row keyed by (ownerId, bundleName). The
    // unique index on that pair guarantees we never create
    // duplicate bundles even if the script is run twice.
    const bundle = await Sprite.findOneAndUpdate(
      { ownerId: ownerObjectId, bundleName },
      {
        $set: {
          ownerEmail,
          isPublic,
          currentVersion: version,
          symbolCount,
        },
        $setOnInsert: {
          ownerId: ownerObjectId,
          bundleName,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      }
    );
    bundleCount += 1;

    // Insert a SpriteVersion mirroring the legacy content. We
    // tolerate E11000 (unique on (spriteId, version)) so a prior
    // partial migration doesn't blow up the whole run.
    try {
      await SpriteVersion.create({
        spriteId: bundle._id,
        version,
        xml,
        symbolIds,
        // The version doc carries the symbol count as a derived
        // field so the library list can stay join-free.
        symbolCount,
      });
      versionCount += 1;
    } catch (err) {
      if (
        err instanceof mongoose.mongo.MongoServerError &&
        err.code === 11000
      ) {
        // Already migrated for this (bundle, version); skip.
      } else {
        throw err;
      }
    }
  }

  console.log(
    `[backfill] Migrated ${legacyDocs.length} legacy sprite row(s) ` +
      `into ${bundleCount} bundle(s) and ${versionCount} version(s). ` +
      `System user: ${String(systemUser._id)}.`,
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
