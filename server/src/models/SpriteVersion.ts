import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * A single version of a sprite bundle. Every save creates a NEW
 * `SpriteVersion` row referencing the parent `Sprite` (bundle) by
 * id, with a monotonically incrementing `version` number scoped to
 * that bundle. The actual XML payload and parsed symbol ids live
 * here, never on the bundle document, so the bundle metadata stays
 * small and the per-version content can be loaded lazily.
 */
const spriteVersionSchema = new Schema(
  {
    // Reference to the parent bundle document. Indexed because every
    // "load latest" / "list versions" / "delete bundle" query starts
    // by narrowing down to the bundle's versions.
    spriteId: {
      type: Schema.Types.ObjectId,
      ref: "Sprite",
      required: true,
      index: true,
    },
    // Monotonic version number scoped to its parent bundle. The
    // unique compound index (spriteId, version) is what guarantees
    // we never end up with two v3 docs for the same bundle even
    // under concurrent writes.
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    // Full SVG sprite XML for this version. Required because a
    // version without content is meaningless and would be a bug.
    xml: {
      type: String,
      required: true,
    },
    // The list of <symbol id="..."> values parsed out of `xml`.
    // Stored alongside the XML so list views don't have to re-parse
    // every version on every render.
    symbolIds: {
      type: [String],
      default: [],
    },
    // Denormalised symbol count for the list view. Mirrors
    // `symbolIds.length` at the time of write but is kept as its
    // own field so the list query can return it without joining
    // / counting array elements.
    symbolCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "sprite_versions",
  }
);

// One document per (spriteId, version) pair. This is the integrity
// guarantee that backs the "next version is max+1" insert pattern.
spriteVersionSchema.index({ spriteId: 1, version: 1 }, { unique: true });
// Optimised "latest version for a bundle" lookup used by the
// default GET endpoint.
spriteVersionSchema.index({ spriteId: 1, version: -1 });

export type SpriteVersionDoc = InferSchemaType<typeof spriteVersionSchema>;
export type SpriteVersionModel = Model<SpriteVersionDoc>;

const SpriteVersion: SpriteVersionModel =
  (mongoose.models.SpriteVersion as SpriteVersionModel | undefined) ??
  mongoose.model<SpriteVersionDoc>(
    "SpriteVersion",
    spriteVersionSchema,
  );

export default SpriteVersion;
