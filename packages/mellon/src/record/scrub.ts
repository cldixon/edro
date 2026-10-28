import { FAKE_HOSTNAME } from "../fake/fixtures.ts";

// Scrubs API responses recorded from the personal Developer Tier before they
// are saved as fixtures. Replacements are consistent (the same RID always maps
// to the same fake RID), so builds, jobs and schedules still link up.

const RID_OR_UUID =
  /\bri\.([a-z0-9-]+)\.([a-z0-9-]+)\.([a-z0-9-]+)\.([A-Za-z0-9._-]+)|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g;

/** Fields that identify a person, and what replaces them. `n` numbers each distinct person. */
const PERSONAL: Record<string, (n: number) => string> = {
  username: (n) => `user-${n}`,
  email: (n) => `user-${n}@example.com`,
  givenName: () => "Ada",
  familyName: () => "Example",
  realm: () => "example-realm",
};
/** Fields dropped entirely: free-form data about a person. */
const DROPPED: Record<string, unknown> = { attributes: {} };

const fakeUuid = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;

export class Scrubber {
  private readonly hostname: string;
  private readonly ids = new Map<string, string>();
  private readonly personal = new Map<string, string>();
  private people = 0;

  /**
   * @param hostname the instance the data came from
   * @param secrets other values that must never appear in the output, e.g. the token used
   */
  constructor(
    hostname: string,
    private readonly secrets: string[] = [],
  ) {
    this.hostname = hostname.toLowerCase();
  }

  private fakeId(original: string, rid?: { service: string; type: string }): string {
    const key = original.toLowerCase();
    let fake = this.ids.get(key);
    if (!fake) {
      const uuid = fakeUuid(this.ids.size + 1);
      fake = rid ? `ri.${rid.service}.main.${rid.type}.${uuid}` : uuid;
      this.ids.set(key, fake);
    }
    return fake;
  }

  private scrubString(s: string): string {
    let out = s.replace(JWT, "[redacted-token]");
    // Personal values first (longest first, so "jane.doe@host" goes before "jane.doe"),
    // since an email address contains the hostname.
    for (const [original, fake] of [...this.personal].sort((a, b) => b[0].length - a[0].length)) {
      out = out.replace(new RegExp(escapeRegExp(original), "gi"), fake);
    }
    out = out.replace(new RegExp(escapeRegExp(this.hostname), "gi"), FAKE_HOSTNAME);
    return out.replace(RID_OR_UUID, (match, service?: string, _instance?: string, type?: string) =>
      service && type ? this.fakeId(match, { service, type }) : this.fakeId(match),
    );
  }

  /** First pass: note every personal value, so it's replaced wherever else it appears. */
  private collect(value: unknown): void {
    if (Array.isArray(value)) {
      for (const v of value) this.collect(v);
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const personalKeys = Object.keys(obj).filter(
        (k) => k in PERSONAL && typeof obj[k] === "string",
      );
      if (personalKeys.length) this.people += 1;
      for (const k of personalKeys) {
        const original = obj[k] as string;
        if (original.length >= 3 && !this.personal.has(original)) {
          this.personal.set(original, (PERSONAL[k] as (n: number) => string)(this.people));
        }
      }
      for (const v of Object.values(obj)) this.collect(v);
    }
  }

  private walk(value: unknown): unknown {
    if (typeof value === "string") return this.scrubString(value);
    if (Array.isArray(value)) return value.map((v) => this.walk(v));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          this.scrubString(k),
          k in DROPPED
            ? DROPPED[k]
            : k in PERSONAL && typeof v === "string"
              ? (this.personal.get(v) ?? this.walk(v))
              : this.walk(v),
        ]),
      );
    }
    return value;
  }

  scrub<T>(value: T): T {
    this.collect(value);
    return this.walk(value) as T;
  }

  /** Original values (hostname, IDs, personal data, secrets) still present in `text`. */
  leaks(text: string): string[] {
    const lower = text.toLowerCase();
    const originals = [this.hostname, ...this.ids.keys(), ...this.personal.keys(), ...this.secrets];
    const found = originals.filter((o) => o && lower.includes(o.toLowerCase()));
    // A fake ID can coincide with an original only if the original was already fake.
    const fakes = new Set([...this.ids.values()].map((v) => v.toLowerCase()));
    return found.filter((o) => !fakes.has(o.toLowerCase()) && o.toLowerCase() !== FAKE_HOSTNAME);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
