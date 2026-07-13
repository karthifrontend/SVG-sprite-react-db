import { Router, type Request, type Response } from "express";
import Sprite from "../models/Sprite.js";
import { ensureConnected } from "../db.js";

const router = Router();

type CreateSpriteBody = {
  name?: unknown;
  bundleName?: unknown;
  xml?: unknown;
  symbolIds?: unknown;
  symbolCount?: unknown;
};

type UpdateSpriteBody = {
  xml?: unknown;
  symbolIds?: unknown;
  symbolCount?: unknown;
};

type RenameSpriteBody = {
  name?: unknown;
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

type SpriteLike = {
  _id: unknown;
  name: string;
  bundleName: string;
  version: number;
  symbolCount: number;
  createdAt?: Date;
  updatedAt?: Date;
};

type SpriteDetailLike = SpriteLike & {
  xml: string;
  symbolIds: string[];
};

function serializeSprite(sprite: SpriteLike) {
  return {
    id: sprite._id,
    name: sprite.name,
    bundleName: sprite.bundleName,
    version: sprite.version,
    symbolCount: sprite.symbolCount,
    createdAt: sprite.createdAt,
    updatedAt: sprite.updatedAt,
  };
}

function serializeSpriteDetail(sprite: SpriteDetailLike) {
  return {
    ...serializeSprite(sprite),
    xml: sprite.xml,
    symbolIds: sprite.symbolIds,
  };
}

/**
 * Save a sprite. Every save creates a NEW version under the bundle
 * (the `name` field, or `bundleName` if provided). The new version
 * number is always (latest + 1) so the client never has to compute it.
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as CreateSpriteBody;

  const name = asString(body.name);
  const bundleName = asString(body.bundleName) ?? name;
  const xml = asString(body.xml);
  const symbolIds = asStringArray(body.symbolIds);
  const symbolCount = asNumber(body.symbolCount, symbolIds.length);

  if (!name) {
    return res.status(400).json({ error: "Sprite name is required." });
  }
  if (!bundleName) {
    return res.status(400).json({ error: "Bundle name is required." });
  }
  if (!xml) {
    return res.status(400).json({ error: "Sprite XML is required." });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const latest = await Sprite.findOne({ bundleName })
      .sort({ version: -1 })
      .lean();
    const nextVersion = (latest?.version ?? 0) + 1;
    const versionName = `${bundleName} v${nextVersion}`;

    const sprite = await Sprite.create({
      name: versionName,
      bundleName,
      version: nextVersion,
      xml,
      symbolIds,
      symbolCount,
    });
    return res.status(201).json(serializeSprite(sprite));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Fetch a single sprite by id. Returns the full XML payload.
 */
router.get("/id/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: "Id parameter is required." });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const sprite = await Sprite.findById(id);
    if (!sprite) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    return res.json(serializeSpriteDetail(sprite));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Fetch the latest version of a sprite bundle by bundle name.
 */
router.get("/:name", async (req: Request, res: Response) => {
  const name = req.params.name;
  if (!name) {
    return res.status(400).json({ error: "Name parameter is required." });
  }

  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const sprite = await Sprite.findOne({ bundleName: name })
      .sort({ version: -1 });
    if (!sprite) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    return res.json(serializeSpriteDetail(sprite));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * List every version of every sprite bundle. The client groups by
 * `bundleName` to render the version tree in the library panel.
 */
router.get("/", async (_req: Request, res: Response) => {
  const connected = await ensureConnected();
  if (!connected) {
    return notConnectedResponse(res);
  }

  try {
    const sprites = await Sprite.find(
      {},
      { name: 1, bundleName: 1, version: 1, symbolCount: 1, updatedAt: 1 }
    )
      .sort({ updatedAt: -1 })
      .lean();
    const list = sprites.map((sprite) => ({
      _id: sprite._id,
      name: sprite.name,
      bundleName: sprite.bundleName,
      version: sprite.version,
      symbolCount: sprite.symbolCount,
      updatedAt: sprite.updatedAt,
    }));
    return res.json(list);
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
router.put("/:id", async (req: Request, res: Response) => {
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
    const sprite = await Sprite.findByIdAndUpdate(
      id,
      { xml, symbolIds, symbolCount },
      { returnDocument: "after", runValidators: true }
    );
    if (!sprite) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    return res.json(serializeSprite(sprite));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

/**
 * Rename a sprite bundle. Updates `bundleName` and the derived
 * `name` (e.g. "my-sprite v3") on every version of the bundle so
 * the library grouping stays consistent.
 */
router.patch("/:id/rename", async (req: Request, res: Response) => {
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
    const target = await Sprite.findById(id);
    if (!target) {
      return res.status(404).json({ error: "Sprite not found." });
    }
    const oldBundleName = target.bundleName;

    // Reject rename collisions: a different bundle already uses the
    // requested name. Renaming would silently merge two libraries.
    if (newBundleName.toLowerCase() !== oldBundleName.toLowerCase()) {
      const collision = await Sprite.findOne({
        bundleName: { $regex: `^${escapeRegExp(newBundleName)}$`, $options: "i" },
      }).lean();
      if (collision) {
        return res.status(409).json({
          error: `A library named "${newBundleName}" already exists.`,
        });
      }
    }

    // Apply the rename to every version of the bundle.
    const versions = await Sprite.find({ bundleName: oldBundleName }).sort({
      version: 1,
    });
    for (const sprite of versions) {
      sprite.bundleName = newBundleName;
      sprite.name =
        sprite.version === 1
          ? newBundleName
          : `${newBundleName} v${sprite.version}`;
      await sprite.save();
    }

    return res.json({
      oldBundleName,
      newBundleName,
      updated: versions.length,
      versions: versions.map(serializeSprite),
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
 * the bundle, useful for a "delete the whole library" action.
 */
router.delete("/:id", async (req: Request, res: Response) => {
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
    const target = await Sprite.findById(id).lean();
    if (!target) {
      return res.status(404).json({ error: "Sprite not found." });
    }

    if (deleteBundle) {
      const result = await Sprite.deleteMany({ bundleName: target.bundleName });
      return res.json({
        bundleName: target.bundleName,
        deleted: result.deletedCount ?? 0,
        scope: "bundle",
      });
    }

    await Sprite.deleteOne({ _id: id });
    const remaining = await Sprite.countDocuments({
      bundleName: target.bundleName,
    });
    return res.json({
      bundleName: target.bundleName,
      version: target.version,
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
