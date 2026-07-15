// User model — persists authenticated principals.
//
// Two flavours of user are supported by the same collection:
//   • OAuth users (Google / Microsoft) where the user is upserted
//     on sign-in keyed by the provider's stable `sub` claim. These
//     users have no password hash (they authenticate with the
//     provider).
//   • Password users (future / external) where `passwordHash` is
//     set and `provider` is `password` (or another credential-
//     bearing provider). The `name` field on the document is the
//     user-visible display name (mirrors the spec field).
//
// The Google sign-in flow upserts a user document keyed by the
// `sub` claim so a returning user is matched deterministically and
// we never create duplicate accounts for the same Google account.
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
      // before authenticated writes started. `password` covers
      // direct credential-based accounts that use the `name` /
      // `passwordHash` fields below.
      enum: ["google", "microsoft", "demo", "system", "password"],
      default: "google",
    },
    providerId: {
      type: String,
      required: true,
      trim: true,
    },
    // User-visible display name. For OAuth users this mirrors
    // `displayName` (the Google/Microsoft profile name); for
    // password users it's the value they registered with.
    // `name` is kept as an alias of `displayName` for the
    // password-style documents described in the spec.
    name: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
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
    // Hashed password for direct credential-based sign-in. Only
    // populated for `provider: "password"` users. Stored as a
    // string so the model can hold any hash format the auth code
    // chooses (bcrypt, argon2, scrypt, etc.) without needing a
    // schema migration when the algorithm changes.
    passwordHash: {
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
