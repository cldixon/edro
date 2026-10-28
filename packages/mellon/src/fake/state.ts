import type * as Admin from "@osdk/foundry.admin";
import type * as Orchestration from "@osdk/foundry.orchestration";

/** In-memory contents of a fake Foundry instance, in the API's own wire shapes. */
export interface FakeFoundryState {
  /** Bearer tokens the fake accepts. */
  tokens: string[];
  /** Confidential OAuth clients (client credentials), keyed by client ID, to their secrets. */
  oauthClients: Record<string, string>;
  /** Public OAuth clients (browser sign-in) and their registered redirect URIs. */
  publicClients: Record<string, string[]>;
  /** Issued authorization codes, waiting to be exchanged. */
  authCodes: Record<
    string,
    { clientId: string; redirectUri: string; challenge: string; scope: string }
  >;
  /** Valid refresh tokens, to their client ID. */
  refreshTokens: Record<string, string>;
  currentUser: Admin.User;
  builds: Orchestration.Build[];
  jobs: Orchestration.Job[];
  schedules: Orchestration.Schedule[];
  scheduleRuns: Orchestration.ScheduleRun[];
}

/** Obviously fake RIDs: `ri.foundry.main.<type>.00000000-0000-0000-0000-<n>`. */
export function fakeRid(type: string, n: number, service = "foundry"): string {
  return `ri.${service}.main.${type}.00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
}
