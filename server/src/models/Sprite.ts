import mongoose, {
  Schema,
  type InferSchemaType,
  type Model,
} from "mongoose";
import SpriteVersion from "./SpriteVersion.js";

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

/**
 * Cascade-delete: when a bundle document goes away, every version
 * row that points at it must go away too. Mongoose's pre-delete
 * hooks cover `deleteOne`, `deleteMany` (with a single-id filter)
 * and `findOneAndDelete` so the cascade runs no matter which API
 * the caller used. Without this hook, deleting a bundle via
 * `Sprite.deleteOne` from any future code path would leave orphan
 * rows in `sprite_versions` whose `spriteId` references a document
 * that no longer exists.
 *
 * The hooks are written as plain async functions and return
 * promises. Mongoose 9 supports promise-returning hooks natively
 * and we no longer need to thread Mongoose's `next` callback
 * through the cascade. The previous `asNext(next)` plumbing
 * crashed at runtime when Mongoose 9's combined-document-and-query
 * hook machinery passed a non-function sentinel as `next` (it
 * expects the hook to be async in that mode); letting the hook
 * be async and just throwing on error sidesteps the issue
 * entirely.
 *
 * We pull the bundle's `_id` from the query filter (or, for
 * `findOneAndDelete`, by materialising the matched doc) and issue
 * a single `SpriteVersion.deleteMany({ spriteId })` before the
 * bundle itself is removed. If the version delete throws, Mongoose
 * catches the rejection and aborts the bundle delete, leaving the
 * data in a consistent state.
 */

/** Pull the `_id` value out of a Mongoose query filter, if any. */
function readIdFromFilter(filter: unknown): unknown | undefined {
  if (!filter || typeof filter !== "object") return undefined;
  return (filter as { _id?: unknown })._id;
}

/**
 * Resolve the bundle `_id` for a hook invocation. For the
 * document middleware the id lives on `this`; for the query
 * middleware it lives in `getFilter()`. Returns `undefined`
 * when neither is available, in which case the caller should
 * skip the cascade and let the underlying delete proceed.
 */
function resolveBundleIdFromHook(
  thisArg: unknown,
  docArg: unknown
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

/**
 * Issue the version cascade. Throws on failure so Mongoose's
 * promise hook machinery surfaces the error and aborts the
 * parent delete.
 */
async function runCascade(bundleId: unknown): Promise<void> {
  if (bundleId === undefined || bundleId === null) return;
  // The `spriteId` filter is strongly typed on the model; we
  // cast through `unknown` because `bundleId` came from the
  // caller's filter and may be a string, ObjectId, or whatever
  // Mongoose has normalised it to.
  await SpriteVersion.deleteMany({
    spriteId: bundleId,
  } as Record<string, unknown>);
}

/**
 * Combined document + query hook for `deleteOne`. Mongoose 9
 * supports promise-returning middleware, so the hook body just
 * resolves the bundle id, runs the cascade, and lets thrown
 * errors propagate. Mongoose aborts the delete on a rejection.
 */
spriteSchema.pre(
  "deleteOne",
  { document: true, query: true },
  async function preDeleteOneCascade(this: unknown, doc: unknown) {
    const idField = resolveBundleIdFromHook(this, doc);
    if (idField === undefined) {
      // No id in the filter — we can't safely cascade. Let the
      // delete proceed; the route layer always filters by `_id`.
      return;
    }
    await runCascade(idField);
  }
);

spriteSchema.pre("deleteMany", async function preDeleteManyCascade(this: unknown) {
  const ctx = this as { getFilter?: () => unknown };
  if (typeof ctx.getFilter !== "function") return;
  const idField = readIdFromFilter(ctx.getFilter());
  if (idField === undefined) {
    // No id in the filter — we can't safely cascade. Let the
    // delete proceed; the route layer always filters by `_id`.
    return;
  }
  await runCascade(idField);
});

spriteSchema.pre(
  "findOneAndDelete",
  { document: true, query: true },
  async function preFindOneAndDeleteCascade(this: unknown) {
    // Materialise the about-to-be-removed doc so we have its id;
    // the `findOneAndDelete` filter alone isn't enough because
    // callers may have used anything (`bundleName`, `ownerId`,
    // etc.) as the selector. Reusing `this.model.findOne(filter)`
    // shares the connection / model and keeps the lookup cheap.
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
  }
);

export type SpriteDoc = InferSchemaType<typeof spriteSchema>;
export type SpriteModel = Model<SpriteDoc>;

const Sprite: SpriteModel =
  (mongoose.models.Sprite as SpriteModel | undefined) ??
  mongoose.model<SpriteDoc>("Sprite", spriteSchema);

export default Sprite;
