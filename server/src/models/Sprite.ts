import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * A persisted SVG sprite document. Sprites are versioned: each save
 * creates a new document under the same `bundleName`, with a
 * monotonically incrementing `version`. `name` mirrors `bundleName`
 * for the first version and is kept as a `versionName` slug like
 * "my-sprite v3" for convenience.
 */
const spriteSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    bundleName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    xml: {
      type: String,
      required: true,
    },
    symbolIds: {
      type: [String],
      default: [],
    },
    symbolCount: {
      type: Number,
      default: 0,
    },
    // The Google-authenticated user that owns this sprite. Set on
    // create from the bearer-token session; used to scope reads
    // and to gate edits / deletes.
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ownerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // When true, every authenticated user can see this bundle in
    // the library list and load the latest version. Edits, renames
    // and deletes are still restricted to `ownerId` server-side.
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "sprites",
  }
);

// Two sprites can share a `name` (one is a different version of the
// other) but never the same (bundleName, version) pair.
spriteSchema.index({ bundleName: 1, version: 1 }, { unique: true });
spriteSchema.index({ bundleName: 1, updatedAt: -1 });
// Owner-scoped lookups (list my libraries, count by owner).
spriteSchema.index({ ownerId: 1, updatedAt: -1 });

export type SpriteDoc = InferSchemaType<typeof spriteSchema>;
export type SpriteModel = Model<SpriteDoc>;

const Sprite: SpriteModel =
  (mongoose.models.Sprite as SpriteModel | undefined) ??
  mongoose.model<SpriteDoc>("Sprite", spriteSchema);

export default Sprite;
