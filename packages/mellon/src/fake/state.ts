import type * as Admin from "@osdk/foundry.admin";
import type * as Orchestration from "@osdk/foundry.orchestration";

/** In-memory contents of a fake Foundry instance, in the API's own wire shapes. */
export interface FakeFoundryState {
  /** Bearer tokens the fake accepts. */
  tokens: string[];
  /** OAuth clients accepted by the token endpoint, keyed by client ID. */
  oauthClients: Record<string, string>;
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
