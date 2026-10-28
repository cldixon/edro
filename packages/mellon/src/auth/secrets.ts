import { EdroError } from "../errors.ts";

export type SecretKey = "token" | "client_secret";

/** Where profile secrets live. The OS keychain in practice, memory in tests. */
export interface SecretStore {
  get(profile: string, key: SecretKey): Promise<string | null>;
  set(profile: string, key: SecretKey, value: string): Promise<void>;
  delete(profile: string, key: SecretKey): Promise<void>;
}

const SERVICE = "edro";

/**
 * The OS keychain via Bun.secrets: Keychain on macOS, libsecret on Linux,
 * Credential Manager on Windows. Containers and CI usually have none; there,
 * reads return null and edro falls back to environment variables.
 */
export function keychainStore(): SecretStore {
  const name = (profile: string, key: SecretKey) => `${profile}/${key}`;
  return {
    async get(profile, key) {
      try {
        return await Bun.secrets.get({ service: SERVICE, name: name(profile, key) });
      } catch {
        return null;
      }
    },
    async set(profile, key, value) {
      try {
        await Bun.secrets.set({ service: SERVICE, name: name(profile, key), value });
      } catch (e) {
        throw new EdroError(
          `Could not save credentials to the OS keychain: ${(e as Error).message}`,
          "config",
          "Without a keychain, set FOUNDRY_HOSTNAME and FOUNDRY_TOKEN in the environment instead.",
        );
      }
    },
    async delete(profile, key) {
      try {
        await Bun.secrets.delete({ service: SERVICE, name: name(profile, key) });
      } catch {
        // Nothing stored, or no keychain: either way there's nothing to remove.
      }
    },
  };
}

export function memoryStore(initial: Record<string, string> = {}): SecretStore {
  const values = new Map(Object.entries(initial));
  return {
    async get(profile, key) {
      return values.get(`${profile}/${key}`) ?? null;
    },
    async set(profile, key, value) {
      values.set(`${profile}/${key}`, value);
    },
    async delete(profile, key) {
      values.delete(`${profile}/${key}`);
    },
  };
}
