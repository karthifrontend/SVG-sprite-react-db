// Model for a single version of a sprite bundle. Each version is a separate document in the `sprite_versions` collection, and is linked to its parent bundle via the `spriteId` field.
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const spriteVersionSchema = new Schema(
  {
    // The parent bundle of this version.
    spriteId: {
      type: Schema.Types.ObjectId,
      ref: "Sprite",
      required: true,
      index: true,
    },
    // The version number of this version. Each version of a bundle has a unique version number, starting at 1 and incrementing by 1 for each new version.
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    // The SVG XML content of this version. This is the raw SVG content of the sprite bundle, including all <symbol> elements.
    xml: {
      type: String,
      required: true,
    },
    // The list of symbol IDs in this version. This is a denormalized list of the IDs of all <symbol> elements in the SVG content, used for quick lookups and to avoid parsing the XML.
    symbolIds: {
      type: [String],
      default: [],
    },
    // The number of symbols in this version. This is a denormalized count of the number of <symbol> elements in the SVG content, used for quick lookups and to avoid parsing the XML.
    symbolCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: "sprite_versions",
  },
);

// One document per (spriteId, version) pair. This is the integrity guarantee that backs the "next version is max+1" insert pattern.
spriteVersionSchema.index({ spriteId: 1, version: 1 }, { unique: true });
// Optimised "latest version for a bundle" lookup used by the default GET endpoint.
spriteVersionSchema.index({ spriteId: 1, version: -1 });

export type SpriteVersionDoc = InferSchemaType<typeof spriteVersionSchema>;
export type SpriteVersionModel = Model<SpriteVersionDoc>;

const SpriteVersion: SpriteVersionModel =
  (mongoose.models.SpriteVersion as SpriteVersionModel | undefined) ??
  mongoose.model<SpriteVersionDoc>("SpriteVersion", spriteVersionSchema);

export default SpriteVersion;
