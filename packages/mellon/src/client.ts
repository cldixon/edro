/** A named connection to a Foundry instance. Secrets never live here. */
export interface Profile {
  name: string;
  hostname: string;
}

export interface CurrentUser {
  username: string;
}

/**
 * The only surface the CLI and TUI use to talk to Foundry. Keeping every
 * Foundry-specific call behind this interface lets us swap the SDK, mock it
 * in tests, or run on canned demo data.
 */
export interface MellonClient {
  readonly profile: Profile;
  whoami(): Promise<CurrentUser>;
}

/** Stub client. Real auth and API calls land in later issues. */
export function createClient(profile: Profile): MellonClient {
  return {
    profile,
    async whoami() {
      throw new NotImplementedError("whoami");
    },
  };
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}
