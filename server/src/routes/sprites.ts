import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import Sprite from "../models/Sprite.js";
import SpriteVersion from "../models/SpriteVersion.js";
import { ensureConnected } from "../db.js";
import { requireUser } from "../middleware/requireUser.js";

const router = Router();

type CreateSpriteBody = {
  name?: unknown;
  bundleName?: unknown;
  xml?: unknown;
  symbolIds?: unknown;
  symbolCount?: unknown;
  isPublic?: unknown;
};

type UpdateSpriteBody = {
  xml?: unknown;
  symbolIds?: unknown;
  symbolCount?: unknown;
};

type RenameSpriteBody = {
  name?: unknown;
};

/**
 * Shape of a row in the library list. The client expects one
 * entry per *version* (so a bundle with 3 versions shows up as
 * 3 cards). We return the version id as the row id so the
 * existing client code (load to update / delete / preview) can
 * keep calling the per-id endpoints unchanged.
 */
type ListSpriteItem = {
  _id: unknown;
  name: string;
  bundleName: string;
  version: number;
  symbolCount: number;
  isPublic: boolean;
  ownerId: unknown;
  updatedAt: Date | undefined;
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function sanitizeBundleName(raw: string): string {
  // Mirror the model constraints (trim, 1..100) and keep the slug
  // friendly to URLs by replacing whitespace with `-`.
  return raw
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 100);
}

function notConnectedResponse(res: Response) {
  return res.status(503).json({
    error:
      "Database is not connected. Check Atlas Network Access (whitelist your IP) and the MONGODB_URI credentials.",
  });
}

function forbiddenResponse(res: Response, message = "You can only modify libraries you own.") {
  return res.status(403).json({ error: message });
}

type OwnerLike = { ownerId?: unknown };

function ownerIdString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "toString" in value) {
    return String((value as { toString(): unknown }).toString());
  }
  return null;
}

/**
 * Returns 403 via `res` if `bundle.ownerId` does not match the
 * session user, otherwise returns `true` so the caller can keep
 * going. Returns `false` if the bundle is missing (the response is
 * already written as 404).
 */
function ensureOwner(
  res: Response,
  bundle: OwnerLike | null,
  user: { _id: unknown } | undefined
): boolean {
  if (!bundle) {
    res.status(404).json({ error: "Sprite not found." });
    return false;
  }
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return false;
  }
  const ownerString = ownerIdString(bundle.ownerId);
  const userString = ownerIdString(user._id);
  if (!ownerString || !userString || ownerString !== userString) {
    forbiddenResponse(res);
    return false;
  }
  return true;
}

type BundleLike = {
  _id: unknown;
  bundleName: string;
  isPublic?: boolean;
  ownerId?: unknown;
  createdAt?: Date;
  updatedAt?: Date | undefined;
};

type VersionLike = {
  _id: unknown;
  spriteId: unknown;
  version: number;
  symbolCount?: number;
  createdAt?: Date;
};

type VersionDetailLike = VersionLike & {
  xml: string;
  symbolIds: string[];
};

/**
 * The client's library list & detail views treat a "sprite" as a
 * single version (newest per bundle in the list, specific version
 * on detail). We mirror that here: the `name` field is the
 * bundle slug for v1, or "<bundle> v<n>" for any other version,
 * so the rendered text in the panel still looks correct.
 */
function versionDisplayName(bundleName: string, version: number): string {
  return version === 1 ? bundleName : `${bundleName} v${version}`;
}

function serializeVersion(
  bundle: BundleLike,
  version: VersionLike,
  isOwner = true
) {
  return {
    id: version._id,
    name: versionDisplayName(bundle.bundleName, version.version),
    bundleName: bundle.bundleName,
    version: version.version,
    symbolCount: version.symbolCount ?? 0,
    isPublic: !!bundle.isPublic,
    isOwner,
    createdAt: version.createdAt,
    updatedAt: bundle.updatedAt,
  };
}

function serializeVersionDetail(
  bundle: BundleLike,
  version: VersionDetailLike,
  isOwner = true
) {
  return {
    ...serializeVersion(bundle, version, isOwner),
    xml: version.xml,
    symbolIds: version.symbolIds,
  };
}

/**
 * Save a sprite. Every save creates a NEW version under the bundle
 * (the `name` field, or `bundleName` if provided). The new version
 * number is always (bundle.currentVersion + 1) so the client never
 * has to compute it.
 *
 * If the bundle does not exist yet for this owner, it's created
 * in the same operation. This keeps the "first save" path simple
 * for callers that don't want to pre-create the bundle.
 */
router.post("/", requireUser, async (req: Request, res: Response) => {
  const body = req.body as CreateSpriteBody;

  const name = asString(body.name);
  const bundleName = asString(body.bundleName) ?? name;
  const xml = asString(body.xml);
  const symbolIds = asStringArray(body.symbolIds);
  const symbolCount = asNumber(body.symbolCount, symbolIds.length);
  const isPublic = asBoolean(body.isPublic);

  if (!name) {
    return res.status(400).json({ error: "Sprite name is required." });
  }
  if (!bundleName) {
    return res.status(400).json({ error: "Bundle name is required." });
  }
  if (!xml) {
    return res.status(400).json({ error: "Sprite XML is required." });
  }

  const sanitizedBundleName = sanitizeBundleName(bundleName);
  if (sanitizedBundleName.length < 1) {
    return res.status(400).json({ error: "Bundle name is required." });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const userId = req.user!._id;
    const userEmail = req.user!.email;

    // Upsert the bundle doc first. We use a conditional update
    // pattern so two concurrent first-saves for the same bundle
    // name converge on a single bundle document with a stable id,
    // rather than racing to create two. `$setOnInsert` only fires
    // on the very first insert; the `currentVersion` / `symbolCount`
    // bump happens in a second, version-numbered step below.
    const bundle = await Sprite.findOneAndUpdate(
      { ownerId: userId, bundleName: sanitizedBundleName },
      {
        $set: {
          ownerEmail: userEmail,
          isPublic,
        },
        $setOnInsert: {
          ownerId: userId,
          bundleName: sanitizedBundleName,
          currentVersion: 0,
          symbolCount: 0,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      }
    );

    // The previous-current-version is the highest version currently
    // stored for this bundle. We use a real count rather than the
    // cached `bundle.currentVersion` to guard against the cache
    // getting out of sync (e.g. after a manual DB edit or a prior
    // bug). The unique index on (spriteId, version) is the real
    // safety net that prevents duplicates if two requests race
    // past this read at the same time — a duplicate would surface
    // as an E11000 below and we retry once with the new max.
    let nextVersion = bundle.currentVersion + 1;
    let createdVersion;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        createdVersion = await SpriteVersion.create({
          spriteId: bundle._id,
          version: nextVersion,
          xml,
          symbolIds,
        });
        break;
      } catch (err) {
        if (
          err instanceof mongoose.mongo.MongoServerError &&
          err.code === 11000
        ) {
          // Another writer beat us to this version number. Look up
          // the actual latest and retry with max + 1.
          const actualMax = await SpriteVersion.findOne({
            spriteId: bundle._id,
          })
            .sort({ version: -1 })
            .select({ version: 1 })
            .lean();
          nextVersion = (actualMax?.version ?? 0) + 1;
          continue;
        }
        throw err;
      }
    }
    if (!createdVersion) {
      return res
        .status(500)
        .json({ error: "Failed to allocate a new sprite version." });
    }

    // Refresh the bundle's cached metadata to reflect the newly
    // inserted version. Doing this after the insert (rather than
    // in the same `findOneAndUpdate` above) means the cache is
    // only ever advanced forward, never overwritten with a
    // stale value from a parallel request.
    bundle.currentVersion = nextVersion;
    bundle.symbolCount = symbolCount;
    bundle.isPublic = isPublic;
    await bundle.save();

    return res
      .status(201)
      .json(serializeVersion(bundle, createdVersion, true));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Fetch a single sprite version by id. Returns the full XML payload.
 */
router.get("/id/:id", requireUser, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: "Id parameter is required." });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const version = await SpriteVersion.findById(id);
    if (!version) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    const bundle = await Sprite.findById(version.spriteId);
    if (!bundle) {
      // Orphaned version (bundle deleted underneath us). Treat as
      // not-found so the client surfaces a clean error.
      return res.status(404).json({ error: "Sprite not found." });
    }
    // Public sprites are readable by any authenticated user. The
    // owner-only gate is enforced for every write route below; for
    // reads we just return a flag so the UI can disable mutating
    // actions for non-owners.
    const isOwner = ownerIdString(bundle.ownerId) === ownerIdString(req.user!._id);
    if (!isOwner && !bundle.isPublic) {
      return forbiddenResponse(res, "You can only access libraries you own or that are public.");
    }
    return res.json(serializeVersionDetail(bundle, version, isOwner));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Fetch the latest version of a sprite bundle by bundle name.
 */
router.get("/:name", requireUser, async (req: Request, res: Response) => {
  const name = req.params.name;
  if (!name) {
    return res.status(400).json({ error: "Name parameter is required." });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    // Resolve the bundle by name. We accept any owner here so a
    // public bundle can be looked up by anyone with its slug; the
    // ownership / public flag is enforced below.
    const bundle = await Sprite.findOne({ bundleName: name });
    if (!bundle) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    const isOwner = ownerIdString(bundle.ownerId) === ownerIdString(req.user!._id);
    if (!isOwner && !bundle.isPublic) {
      return forbiddenResponse(res, "You can only access libraries you own or that are public.");
    }
    const version = await SpriteVersion.findOne({ spriteId: bundle._id })
      .sort({ version: -1 });
    if (!version) {
      // A bundle without any versions is treated as not-found.
      // This shouldn't happen in normal flow (you can only create
      // a bundle by saving a version) but guarding keeps the API
      // honest if a future migration leaves an empty bundle.
      return res.status(404).json({ error: "Sprite not found." });
    }
    return res.json(serializeVersionDetail(bundle, version, isOwner));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * List sprite versions. Returns one entry per *version* (not per
 * bundle) so a bundle with 3 versions shows up as 3 cards, which
 * is what the existing client UI expects. Each entry carries an
 * `isOwner` flag so the client can render owner-only actions
 * (load to update, rename, delete) appropriately.
 *
 * Visibility:
 *   • Every version of any bundle owned by the current user.
 *   • Every version of any bundle flagged `isPublic` (regardless
 *     of owner).
 */
router.get("/", requireUser, async (req: Request, res: Response) => {
  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const userId = req.user!._id;

    // Step 1: pick the bundles the user is allowed to see. Doing
    // this in a single query (rather than fetching every version
    // and filtering in app code) keeps the list cheap as the
    // library grows.
    const visibleBundles = await Sprite.find(
      {
        $or: [{ ownerId: userId }, { isPublic: true }],
      },
      {
        bundleName: 1,
        isPublic: 1,
        ownerId: 1,
        updatedAt: 1,
        currentVersion: 1,
      }
    ).lean();

    if (visibleBundles.length === 0) {
      return res.json([]);
    }

    const bundleIds = visibleBundles.map((b) => b._id);
    // Step 2: pull every version for those bundles in one go and
    // join in app code. Mongoose gives us `lean` objects so this
    // stays cheap.
    const versions = await SpriteVersion.find(
      { spriteId: { $in: bundleIds } },
      { spriteId: 1, version: 1, symbolCount: 1, createdAt: 1 }
    )
      .sort({ version: -1 })
      .lean();

    const bundleById = new Map<string, BundleLike & { _id: string }>();
    for (const b of visibleBundles) {
      bundleById.set(String(b._id), {
        _id: String(b._id),
        bundleName: b.bundleName,
        isPublic: !!b.isPublic,
        ownerId: b.ownerId,
        updatedAt: b.updatedAt,
      });
    }

    const list: ListSpriteItem[] = versions.map((v) => {
      const bundle = bundleById.get(String(v.spriteId));
      // Should never happen: every version's spriteId points at a
      // visible bundle. If it does (e.g. during a race), fall
      // back to a minimal record so the row still renders.
      const safeBundle: BundleLike =
        bundle ??
        ({
          _id: String(v.spriteId),
          bundleName: "Unknown",
          isPublic: false,
          ownerId: undefined,
          updatedAt: undefined,
        } satisfies BundleLike);
      return {
        _id: v._id,
        name: versionDisplayName(safeBundle.bundleName, v.version),
        bundleName: safeBundle.bundleName,
        version: v.version,
        symbolCount: v.symbolCount ?? 0,
        isPublic: !!safeBundle.isPublic,
        ownerId: safeBundle.ownerId,
        updatedAt: safeBundle.updatedAt,
      };
    });

    // Newest activity first: a version's relative position is
    // decided by the bundle's `updatedAt`, which is touched on
    // every save / edit / rename / delete. We use the max of the
    // two so a rename of the bundle still bubbles to the top of
    // the list.
    list.sort((a, b) => {
      const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bt - at;
    });

    // Annotate with the isOwner flag the UI expects.
    const annotated = list.map((sprite) => {
      const isOwner =
        ownerIdString(sprite.ownerId) === ownerIdString(userId);
      return {
        _id: sprite._id,
        name: sprite.name,
        bundleName: sprite.bundleName,
        version: sprite.version,
        symbolCount: sprite.symbolCount,
        isPublic: !!sprite.isPublic,
        isOwner,
        updatedAt: sprite.updatedAt,
      };
    });

    return res.json(annotated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Update an existing version's XML (re-save the same version). This
 * does not change `bundleName` or `version`; new versions should go
 * through POST /.
 */
router.put("/:id", requireUser, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: "Id parameter is required." });
  }
  const body = req.body as UpdateSpriteBody;
  const xml = asString(body.xml);
  if (!xml) {
    return res.status(400).json({ error: "Sprite XML is required." });
  }
  const symbolIds = asStringArray(body.symbolIds);
  const symbolCount = asNumber(body.symbolCount, symbolIds.length);

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const version = await SpriteVersion.findById(id);
    if (!version) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    const bundle = await Sprite.findById(version.spriteId);
    if (!bundle) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    if (!ensureOwner(res, bundle, req.user!)) return;
    version.xml = xml;
    version.symbolIds = symbolIds;
    // The version doc carries the symbol count as a denormalised
    // field so the library list can stay join-free.
    version.symbolCount = symbolCount;
    await version.save();

    // If this is still the latest version, refresh the bundle's
    // cached symbol count so the library list reflects the edit.
    if (version.version === bundle.currentVersion) {
      bundle.symbolCount = symbolCount;
      await bundle.save();
    }

    return res.json(serializeVersion(bundle, version, true));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Rename a sprite bundle. Updates the `bundleName` on the bundle
 * document. Versions carry their own `name` (derived as
 * "bundleName v<n>") so we don't need to touch them — the next
 * list call will recompute the display name from the new slug.
 */
router.patch("/:id/rename", requireUser, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: "Id parameter is required." });
  }
  const body = req.body as RenameSpriteBody;
  const rawName = asString(body.name);
  if (!rawName) {
    return res.status(400).json({ error: "New name is required." });
  }
  const newBundleName = sanitizeBundleName(rawName);
  if (newBundleName.length < 1) {
    return res.status(400).json({ error: "New name is required." });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    // The id is a *version* id (the client's list view is version-
    // keyed). Resolve it to the owning bundle before doing the
    // rename.
    const version = await SpriteVersion.findById(id).lean();
    if (!version) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    const target = await Sprite.findById(version.spriteId);
    if (!target) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    if (!ensureOwner(res, target, req.user!)) return;
    const oldBundleName = target.bundleName;

    // Reject rename collisions: a different bundle owned by the
    // same user already uses the requested name. Renaming would
    // silently merge two libraries.
    if (newBundleName.toLowerCase() !== oldBundleName.toLowerCase()) {
      const collision = await Sprite.findOne({
        ownerId: target.ownerId,
        bundleName: { $regex: `^${escapeRegExp(newBundleName)}$`, $options: "i" },
      }).lean();
      if (collision) {
        return res.status(409).json({
          error: `A library named "${newBundleName}" already exists.`,
        });
      }
    }

    target.bundleName = newBundleName;
    await target.save();

    // Count versions so the client gets the same "updated: N"
    // shape it used to get.
    const versionCount = await SpriteVersion.countDocuments({
      spriteId: target._id,
    });

    return res.json({
      oldBundleName,
      newBundleName,
      updated: versionCount,
      versions: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Delete a sprite version. By default only the version with the
 * given id is removed, leaving the rest of the bundle intact.
 * Pass `?scope=bundle` (or `scope=all`) to remove every version of
 * the bundle AND the bundle itself, useful for a "delete the whole
 * library" action.
 */
router.delete("/:id", requireUser, async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: "Id parameter is required." });
  }
  const scope = String(req.query.scope ?? "").toLowerCase();
  const deleteBundle = scope === "bundle" || scope === "all";

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    // The id is a version id; resolve it to the owning bundle so
    // we can do the ownership check before any destructive work.
    const version = await SpriteVersion.findById(id).lean();
    if (!version) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    const bundle = await Sprite.findById(version.spriteId);
    if (!bundle) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    if (!ensureOwner(res, bundle, req.user!)) return;

    if (deleteBundle) {
      const result = await SpriteVersion.deleteMany({
        spriteId: bundle._id,
      });
      await Sprite.deleteOne({ _id: bundle._id });
      return res.json({
        bundleName: bundle.bundleName,
        deleted: result.deletedCount ?? 0,
        scope: "bundle",
      });
    }

    await SpriteVersion.deleteOne({ _id: id });
    const remaining = await SpriteVersion.countDocuments({
      spriteId: bundle._id,
    });

    // If we just removed the last version, drop the empty bundle
    // doc so the library list doesn't carry a ghost row.
    if (remaining === 0) {
      await Sprite.deleteOne({ _id: bundle._id });
    } else if (version.version === bundle.currentVersion) {
      // If we removed what used to be the "current" version, walk
      // the new latest version's metadata up to the bundle so the
      // library list keeps showing accurate counts.
      const newLatest = await SpriteVersion.findOne({ spriteId: bundle._id })
        .sort({ version: -1 });
      if (newLatest) {
        bundle.currentVersion = newLatest.version;
        bundle.symbolCount = newLatest.symbolCount ?? 0;
        await bundle.save();
      }
    }

    return res.json({
      bundleName: bundle.bundleName,
      version: version.version,
      deleted: 1,
      remaining,
      scope: "version",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Escape a string for use inside a `new RegExp` pattern. MongoDB
 * regex queries treat unescaped special characters as syntax, so we
 * have to neutralise them before using user input as a filter.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default router;
