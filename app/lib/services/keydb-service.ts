import { openDB, DBSchema, IDBPDatabase } from "idb";

import { bufferToBase64, base64ToArray } from "../helpers/binary-helpers";
import { getDbKey } from "./crypto-service";

interface KeyDB extends DBSchema {
  ak: {
    key: string;
    value: {
      data: string;
      setOn: number;
      usages: KeyUsage[];
    };
  };
}

let keyDb: IDBPDatabase<KeyDB> | undefined;

const getDB = async () => {
  if (keyDb) {
    return keyDb;
  }
  keyDb = await openDB<KeyDB>("kdb", 1, {
    upgrade(db) {
      db.createObjectStore("ak");
    }
  });
  return keyDb;
};

export const storeKey = async (
  key: CryptoKey,
  keyId: string,
  userId: string
) => {
  const db = await getDB();
  const dbKey = await getDbKey(userId);
  if (!dbKey) {
    throw new Error("No dbKey found");
  }
  const keyData = await crypto.subtle.wrapKey("raw", key, dbKey, {
    name: "AES-GCM",
    iv: new TextEncoder().encode(keyId + userId)
  });

  await db.add(
    "ak",
    {
      data: bufferToBase64(keyData),
      setOn: new Date().getTime(),
      usages: key.usages
    },
    keyId
  );
};

export const updateKey = async (
  key: CryptoKey,
  keyId: string,
  userId: string
) => {
  const db = await getDB();
  const dbKey = await getDbKey(userId);
  const keyData = await crypto.subtle.wrapKey("raw", key, dbKey, {
    name: "AES-GCM",
    iv: new TextEncoder().encode(keyId + userId)
  });

  await db.put(
    "ak",
    {
      data: bufferToBase64(keyData),
      setOn: new Date().getTime(),
      usages: key.usages
    },
    keyId
  );
};

export const getKey = async (keyId: string, userId: string) => {
  const db = await getDB();
  const dbKey = await getDbKey(userId);
  const keyData = await db.get("ak", keyId);
  if (!keyData) {
    return;
  }

  if (!keyData.usages) {
    throw new Error(`No usages found for key ${keyId}`);
  }

  // Delete the key if it is older than 14 days
  if (keyData.setOn < new Date(new Date().getDate() + 14).getTime()) {
    await db.delete("ak", keyId);
    return;
  }

  try {
    const key = await crypto.subtle.unwrapKey(
      "raw",
      base64ToArray(keyData.data),
      dbKey,
      {
        name: "AES-GCM",
        iv: new TextEncoder().encode(keyId + userId)
      },
      { name: "AES-GCM" },
      true,
      keyData.usages
    );
    return key;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return;
  }
};

export const getMasterKey = async (
  userId: string,
  shouldRedirect: boolean = true
) => {
  const key = await getKey(userId, userId);
  if (!key && shouldRedirect) {
    window.location.href = "/dash/confirm-password";
    return;
  }
  return key;
};

export const clearStore = async () => {
  const db = await getDB();
  await db.clear("ak");
};
