// User model — persists authenticated principals. The Google sign-in
// flow upserts a user document keyed by the Google `sub` (subject)
// claim so a returning user is matched deterministically and we
// never create duplicate accounts for the same Google account.
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const userSchema = new Schema(
  {
    // Stable, provider-issued identifier. For Google this is the
    // `sub` claim from the id_token. Indexed + unique together with
    // `provider` so the same Google account can never be inserted
    // twice.
    provider: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      // `google` and `microsoft` are real auth providers. `demo`
      // is a built-in shared account for users who just want to
      // try the app without signing in. `system` is reserved for
      // the one-time backfill that claims pre-existing sprites
      // before authenticated writes started.
      enum: ["google", "microsoft", "demo", "system"],
      default: "google",
    },
    providerId: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    picture: {
      type: String,
      default: null,
    },
    // Updated every login so we can show "last seen" in the future
    // and detect stale sessions.
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "users",
  }
);

// One document per (provider, providerId) pair.
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

export type UserDoc = InferSchemaType<typeof userSchema>;
export type UserModel = Model<UserDoc>;

const User: UserModel =
  (mongoose.models.User as UserModel | undefined) ??
  mongoose.model<UserDoc>("User", userSchema);

export default User;
