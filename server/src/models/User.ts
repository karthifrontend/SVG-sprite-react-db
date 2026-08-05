// Model for a user account. One record per external identity (Google), linked to owned sprites.
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const userSchema = new Schema(
  {
    // The external identity provider for this user.
    provider: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: ["google", "microsoft", "system", "password"],
      default: "google",
    },
    // The unique identifier for this user from the external identity provider.
    providerId: {
      type: String,
      required: true,
      trim: true,
    },
    // The user's full name, as provided by the external identity provider.
    name: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    // The user's email address, as provided by the external identity provider.
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    // Whether the user's email address has been verified by the external identity provider.
    emailVerified: {
      type: Boolean,
      default: false,
    },
    // The user's display name, which may be different from their full name.
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    // The URL of the user's profile picture, as provided by the external identity provider.
    picture: {
      type: String,
      default: null,
    },
    // The hashed password for this user, if they registered with a password.
    passwordHash: {
      type: String,
      default: null,
    },
    // The date and time when the user last logged in.
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

// One document per (provider, providerId) pair.
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

export type UserDoc = InferSchemaType<typeof userSchema>;
export type UserModel = Model<UserDoc>;

const User: UserModel =
  (mongoose.models.User as UserModel | undefined) ??
  mongoose.model<UserDoc>("User", userSchema);

export default User;
