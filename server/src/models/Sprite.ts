import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Sprite bundle metadata. One document per logical library (slug).
 * The actual XML / symbolIds / version content lives in the
 * `sprite_versions` collection — this document only carries the
 * shared properties of a bundle: its unique slug, who owns it,
 * whether it's public, the latest version number, and how many
 * symbols that latest version contains.
 */
const spriteSchema = new Schema(
  {
    // Slug used to group versions into a single library. Combined
    // with `ownerId` it must be unique: two owners can each have a
    // library called "icons" without colliding, but one owner
    // cannot have two "icons" bundles. The slug is sanitised on
    // write (trim + collapse whitespace) by the route layer.
    bundleName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    // The Google-authenticated user that owns this bundle. Set on
    // create from the bearer-token session; used to scope reads
    // and to gate edits / renames / deletes. Indexed for the
    // owner-scoped "list my libraries" query.
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
    // The most recent version number across all SpriteVersion
    // rows pointing at this bundle. Bumped every time a new
    // version is inserted. Used as the "next version" hint on
    // save and as the latest-version indicator in the library
    // list (so the UI can label the newest row "v3" without a
    // join).
    currentVersion: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    // Convenience copy of the latest version's symbol count. Kept
    // on the bundle doc so the library list endpoint can return
    // summary rows without pulling in any SpriteVersion data.
    symbolCount: {
      type: Number,
      default: 0,
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

// One bundle name per owner. This is the integrity rule the
// rename-collision check enforces: a given user can never end up
// with two "icons" bundles even if the slug casing differs.
spriteSchema.index({ ownerId: 1, bundleName: 1 }, { unique: true });
// Owner-scoped "list my libraries" lookup. The public branch of
// the same query is satisfied by the `isPublic` index.
spriteSchema.index({ ownerId: 1, updatedAt: -1 });

export type SpriteDoc = InferSchemaType<typeof spriteSchema>;
export type SpriteModel = Model<SpriteDoc>;

const Sprite: SpriteModel =
  (mongoose.models.Sprite as SpriteModel | undefined) ??
  mongoose.model<SpriteDoc>("Sprite", spriteSchema);

export default Sprite;
