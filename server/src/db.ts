import mongoose from "mongoose";
import User from "./models/User.js";
import Sprite from "./models/Sprite.js";
import SpriteVersion from "./models/SpriteVersion.js";

/**
 * Connect to MongoDB Atlas using MONGODB_URI from the environment.
 * Caches the connection across module reloads in dev to avoid
 * exhausting the connection pool.
 */
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined in the environment.");
}

type MongooseGlobal = typeof globalThis & {
  _mongooseConnection?: Promise<typeof mongoose>;
};

const globalForMongoose = globalThis as MongooseGlobal;

const SERVER_SELECTION_TIMEOUT_MS = 10_000;

export async function connectDb(): Promise<typeof mongoose> {
  if (globalForMongoose._mongooseConnection) {
    return globalForMongoose._mongooseConnection;
  }

  // Log connection lifecycle events so failures show up in the terminal
  // immediately, rather than as a generic "buffering timed out" later.
  mongoose.connection.on("connected", () => {
    console.log("[db] Connected to MongoDB Atlas");
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("[db] Disconnected from MongoDB Atlas");
  });
  mongoose.connection.on("error", (err) => {
    console.error("[db] Connection error:", err.message);
  });

  const connection = mongoose
    .connect(MONGODB_URI as string, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    })
    .then(async (m) => {
      // Reconcile the on-disk collection indexes with the schemas
      // defined in code. Mongoose's lazy `ensureIndexes()` only
      // creates missing indexes; it never drops ones the schema
      // no longer references. After the schema refactor that
      // removed the `name` field from `Sprite`, the legacy
      // `name_1` index (created transitively by the old unique
      // compound on `(name, version)`) would otherwise stay on
      // the collection and reject every new bundle write as
      // `E11000 duplicate key ... { name: null }`. `syncIndexes`
      // drops stale indexes and creates the current ones in a
      // single round trip per model.
      try {
        await User.syncIndexes();
        await Sprite.syncIndexes();
        await SpriteVersion.syncIndexes();
      } catch (err) {
        // Don't fail the boot just because the index sync didn't
        // land; surface the error in the logs so it can be
        // diagnosed without taking the API down.
        console.error(
          "[db] Index reconciliation failed:",
          err instanceof Error ? err.message : err,
        );
      }
      return m;
    })
    .catch((err) => {
      console.error(
        `[db] Failed to connect to MongoDB Atlas: ${err.message}\n` +
          `      • Check that your IP is whitelisted in Atlas → Network Access.\n` +
          `      • Verify the username/password in your MONGODB_URI.`
      );
      throw err;
    });

  globalForMongoose._mongooseConnection = connection;
  return connection;
}

/**
 * Ensure the Mongoose connection is ready before running a query.
 * Returns true if ready, false if not connected within the timeout.
 */
export async function ensureConnected(timeoutMs = SERVER_SELECTION_TIMEOUT_MS): Promise<boolean> {
  // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const isReady = () => (mongoose.connection.readyState as number) === 1;
  if (isReady()) return true;
  try {
    await Promise.race([
      connectDb(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("connection wait timed out")), timeoutMs)
      ),
    ]);
    return isReady();
  } catch {
    return false;
  }
}
