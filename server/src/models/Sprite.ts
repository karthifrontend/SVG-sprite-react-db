// The bundle document that represents a single SVG sprite library with bundle name, owner, public/private, latestversion, symbolcount.
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import SpriteVersion from "./SpriteVersion.js";

const spriteSchema = new Schema(
  {
    // The bundle name is the user-facing identifier for the sprite library.
    bundleName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
    // The owner of the bundle.
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // The email of the owner.
    ownerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // The current version number of the bundle.
    currentVersion: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    // The number of symbols in the bundle.
    symbolCount: {
      type: Number,
      default: 0,
    },
    // Public bundles are visible to all users, while private bundles are only visible to the owner.
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "sprites",
  },
);

// One bundle name per owner.
spriteSchema.index({ ownerId: 1, bundleName: 1 }, { unique: true });
// Optimised "list bundles for a user" lookup used by the default GET endpoint.
spriteSchema.index({ ownerId: 1, updatedAt: -1 });

// Cascade delete all versions when a bundle is deleted.
function readIdFromFilter(filter: unknown): unknown | undefined {
  if (!filter || typeof filter !== "object") return undefined;
  return (filter as { _id?: unknown })._id;
}

// Resolve the bundle `_id` for a hook invocation.
function resolveBundleIdFromHook(
  thisArg: unknown,
  docArg: unknown,
): unknown | undefined {
  if (
    docArg &&
    typeof docArg === "object" &&
    "_id" in (docArg as Record<string, unknown>)
  ) {
    return (docArg as { _id?: unknown })._id;
  }
  const ctx = thisArg as { getFilter?: () => unknown; _id?: unknown };
  if (ctx && typeof ctx.getFilter === "function") {
    return readIdFromFilter(ctx.getFilter());
  }
  if (ctx && ctx._id !== undefined) {
    return ctx._id;
  }
  return undefined;
}

// Throws on failure so Mongoose's promise hook machinery surfaces the error and aborts the parent delete.
async function runCascade(bundleId: unknown): Promise<void> {
  if (bundleId === undefined || bundleId === null) return;
  // The `spriteId` filter is strongly typed on the model; we cast through `unknown` because `bundleId` came from the caller's filter and may be a string, ObjectId, or whatever Mongoose has normalised it to.
  await SpriteVersion.deleteMany({
    spriteId: bundleId,
  } as Record<string, unknown>);
}

// Cascade delete all versions when a bundle is deleted. This is a "best effort" cascade; if the filter doesn't include an `_id` we can't safely cascade, so we let the delete proceed and rely on the route layer to always filter by `_id`
spriteSchema.pre(
  "deleteOne",
  { document: true, query: true },
  async function preDeleteOneCascade(this: unknown, doc: unknown) {
    const idField = resolveBundleIdFromHook(this, doc);
    if (idField === undefined) {
      return;
    }
    await runCascade(idField);
  },
);

spriteSchema.pre(
  "deleteMany",
  async function preDeleteManyCascade(this: unknown) {
    const ctx = this as { getFilter?: () => unknown };
    if (typeof ctx.getFilter !== "function") return;
    const idField = readIdFromFilter(ctx.getFilter());
    if (idField === undefined) {
      return;
    }
    await runCascade(idField);
  },
);

spriteSchema.pre(
  "findOneAndDelete",
  { document: true, query: true },
  async function preFindOneAndDeleteCascade(this: unknown) {
    const ctx = this as unknown as {
      getFilter: () => unknown;
      model: Model<{ _id: unknown }>;
    };
    const filter = ctx.getFilter();
    const found = await ctx.model
      .findOne(filter as Record<string, unknown>)
      .select({ _id: 1 })
      .lean();
    if (!found) return;
    await runCascade(found._id);
  },
);

export type SpriteDoc = InferSchemaType<typeof spriteSchema>;
export type SpriteModel = Model<SpriteDoc>;

const Sprite: SpriteModel =
  (mongoose.models.Sprite as SpriteModel | undefined) ??
  mongoose.model<SpriteDoc>("Sprite", spriteSchema);

export default Sprite;
