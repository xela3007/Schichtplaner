import { Algorithm, hash, verify } from "@node-rs/argon2";

// OWASP baseline for Argon2id: m=19 MiB, t=2, p=1.
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Hash to verify against when the user doesn't exist — keeps timing uniform. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing-only");
  return dummyHash;
}
