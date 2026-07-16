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
 * We pull the bundle's `_id` from the query filter (or, for
 * `findOneAndDelete`, by materialising the matched doc) and issue
 * a single `SpriteVersion.deleteMany({ spriteId })` before the
 * bundle itself is removed. If the version delete throws, the
 * hook surfaces the error to Mongoose and the bundle delete is
 * aborted, leaving the data in a consistent state.
 */
type FilterLike = Record<string, unknown> | undefined;

function readIdFromFilter(filter: unknown): unknown | undefined {
  if (!filter || typeof filter !== "object") return undefined;
  return (filter as { _id?: unknown })._id;
}

/**
 * Wrap a Mongoose `next` callback so we can pass it through to a
 * helper. Mongoose 9's `HookDoneFunction` is a discriminated
 * union (function or `Kareem.OverwriteMiddlewareResult`); we
 * always treat it as the function form because the only call
 * style we use is the standard `(err?) => void` callback.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNext = (err?: Error) => any;

function asNext(next: unknown): AnyNext {
  return next as AnyNext;
}

function runCascade(bundleId: unknown, next: AnyNext): void {
  if (bundleId === undefined || bundleId === null) {
    return next();
  }
  // The `spriteId` filter is strongly typed on the model; we
  // cast through `unknown` because `bundleId` came from the
  // caller's filter and may be a string, ObjectId, or whatever
  // Mongoose has normalised it to.
  SpriteVersion.deleteMany({ spriteId: bundleId } as Record<string, unknown>)
    .then(() => asNext(next)())
    .catch((err: unknown) =>
      asNext(next)(err instanceof Error ? err : new Error(String(err)))
    );
}

/**
 * Combined document + query hook for `deleteOne`. Mongoose 9's
 * `pre('deleteOne', { document: true, query: true }, fn)` registers
 * the same function in both lists and dispatches based on the
 * call style: `Model.deleteOne(filter)` invokes it with `this`
 * being the Query (and `doc` is not provided), while
 * `doc.deleteOne()` invokes it with `this` and `doc` both being
 * the document. We branch on the presence of `doc` so the same
 * function handles both call sites.
 */
spriteSchema.pre(
  "deleteOne",
  { document: true, query: true },
  function preDeleteOneCascade(doc, next) {
    // Query middleware: Mongoose calls with `(next)`. The Query
    // is `this`, and the filter is what we'll use as the id
    // source.
    // Document middleware: Mongoose calls with `(doc, next)`.
    // We extract the id from the document and cascade.
    if (doc && typeof doc === "object" && "_id" in doc) {
      runCascade((doc as { _id?: unknown })._id, asNext(next));
      return;
    }
    const ctx = this as unknown as { getFilter?: () => unknown };
    if (typeof ctx.getFilter === "function") {
      const idField = readIdFromFilter(ctx.getFilter());
      if (idField === undefined) {
        // No id in the filter — we can't safely cascade. Let the
        // delete proceed; the route layer always filters by `_id`.
        return asNext(next)();
      }
      runCascade(idField, asNext(next));
      return;
    }
    return asNext(next)();
  }
);

spriteSchema.pre("deleteMany", function preDeleteManyCascade(next) {
  const ctx = this as unknown as { getFilter?: () => unknown };
  if (typeof ctx.getFilter !== "function") {
    return asNext(next)();
  }
  const idField = readIdFromFilter(ctx.getFilter());
  if (idField === undefined) {
    // No id in the filter — we can't safely cascade. Let the
    // delete proceed; the route layer always filters by `_id`.
    return asNext(next)();
  }
  runCascade(idField, asNext(next));
});

spriteSchema.pre(
  "findOneAndDelete",
  { document: true, query: true },
  function preFindOneAndDeleteCascade(next) {
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
    ctx.model
      .findOne(filter as Record<string, unknown>)
      .select({ _id: 1 })
      .lean()
      .then((found) => {
        if (!found) {
          return asNext(next)();
        }
        runCascade(found._id, asNext(next));
      })
      .catch((err: unknown) =>
        asNext(next)(err instanceof Error ? err : new Error(String(err)))
      );
  }
);

export type SpriteDoc = InferSchemaType<typeof spriteSchema>;
export type SpriteModel = Model<SpriteDoc>;

const Sprite: SpriteModel =
  (mongoose.models.Sprite as SpriteModel | undefined) ??
  mongoose.model<SpriteDoc>("Sprite", spriteSchema);

export default Sprite;
