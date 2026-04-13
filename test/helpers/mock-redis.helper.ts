/**
 * @file mock-redis.helper.ts
 *
 * In-memory mock for RedisClientType (ioredis-compatible).
 * Supports TTL simulation via advanceTime() for cache expiry tests.
 * Implements: get, set, setEx, del, keys, expire, hSet, hGetAll,
 *   sAdd, sRem, sMembers, sCard, evalSha, scriptLoad, scan, ping,
 *   scanIterator.
 */
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

interface StoredValue {
  value: string;
  expiresAt: number | null; // epoch ms, null = no expiry
}

interface HashValue {
  fields: Record<string, string>;
  expiresAt: number | null;
}

interface SetValue {
  members: Set<string>;
  expiresAt: number | null;
}

export function createMockRedisClient() {
  const strings = new Map<string, StoredValue>();
  const hashes = new Map<string, HashValue>();
  const sets = new Map<string, SetValue>();
  const scripts = new Map<string, string>(); // sha → script body

  let now = Date.now();
  let scriptCounter = 0;

  function isExpired(expiresAt: number | null): boolean {
    return expiresAt !== null && expiresAt <= now;
  }

  function cleanExpired() {
    for (const [k, v] of strings) {
      if (isExpired(v.expiresAt)) strings.delete(k);
    }
    for (const [k, v] of hashes) {
      if (isExpired(v.expiresAt)) hashes.delete(k);
    }
    for (const [k, v] of sets) {
      if (isExpired(v.expiresAt)) sets.delete(k);
    }
  }

  const client = {
    get: jest.fn(async (key: string): Promise<string | null> => {
      cleanExpired();
      const entry = strings.get(key);
      if (!entry || isExpired(entry.expiresAt)) {
        strings.delete(key);
        return null;
      }
      return entry.value;
    }),

    mGet: jest.fn(async (keys: string[]): Promise<(string | null)[]> => {
      cleanExpired();
      return keys.map((key) => {
        const entry = strings.get(key);
        if (!entry || isExpired(entry.expiresAt)) {
          strings.delete(key);
          return null;
        }
        return entry.value;
      });
    }),

    set: jest.fn(async (key: string, value: string): Promise<void> => {
      strings.set(key, { value, expiresAt: null });
    }),

    setEx: jest.fn(
      async (key: string, ttlSeconds: number, value: string): Promise<void> => {
        strings.set(key, {
          value,
          expiresAt: now + ttlSeconds * 1000,
        });
      },
    ),

    del: jest.fn(async (keys: string | string[]): Promise<number> => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      let deleted = 0;
      for (const k of keyList) {
        if (strings.delete(k) || hashes.delete(k) || sets.delete(k)) {
          deleted++;
        }
      }
      return deleted;
    }),

    keys: jest.fn(async (pattern: string): Promise<string[]> => {
      cleanExpired();
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      );
      const allKeys = [...strings.keys(), ...hashes.keys(), ...sets.keys()];
      return allKeys.filter((k) => regex.test(k));
    }),

    expire: jest.fn(async (key: string, seconds: number): Promise<number> => {
      const expiresAt = now + seconds * 1000;
      const sv = strings.get(key);
      if (sv) {
        sv.expiresAt = expiresAt;
        return 1;
      }
      const hv = hashes.get(key);
      if (hv) {
        hv.expiresAt = expiresAt;
        return 1;
      }
      const setv = sets.get(key);
      if (setv) {
        setv.expiresAt = expiresAt;
        return 1;
      }
      return 0;
    }),

    // ─── Hashes ───────────────────────────────────────
    hSet: jest.fn(
      async (
        key: string,
        ...fieldsAndValues: (string | Record<string, string>)[]
      ): Promise<number> => {
        let entry = hashes.get(key);
        if (!entry || isExpired(entry.expiresAt)) {
          entry = { fields: {}, expiresAt: null };
          hashes.set(key, entry);
        }

        // Support both hSet(key, field, value, field, value) and hSet(key, { field: value })
        if (
          fieldsAndValues.length === 1 &&
          typeof fieldsAndValues[0] === 'object'
        ) {
          const obj = fieldsAndValues[0];
          Object.assign(entry.fields, obj);
          return Object.keys(obj).length;
        }

        let count = 0;
        for (let i = 0; i < fieldsAndValues.length; i += 2) {
          entry.fields[fieldsAndValues[i] as string] = fieldsAndValues[
            i + 1
          ] as string;
          count++;
        }
        return count;
      },
    ),

    hGetAll: jest.fn(async (key: string): Promise<Record<string, string>> => {
      cleanExpired();
      const entry = hashes.get(key);
      if (!entry || isExpired(entry.expiresAt)) return {};
      return { ...entry.fields };
    }),

    hGet: jest.fn(
      async (key: string, field: string): Promise<string | null> => {
        cleanExpired();
        const entry = hashes.get(key);
        if (!entry || isExpired(entry.expiresAt)) return null;
        return entry.fields[field] ?? null;
      },
    ),

    exists: jest.fn(async (key: string): Promise<number> => {
      cleanExpired();
      if (strings.has(key) || hashes.has(key) || sets.has(key)) return 1;
      return 0;
    }),

    // ─── Sets ─────────────────────────────────────────
    sAdd: jest.fn(
      async (key: string, ...members: string[]): Promise<number> => {
        let entry = sets.get(key);
        if (!entry || isExpired(entry.expiresAt)) {
          entry = { members: new Set(), expiresAt: null };
          sets.set(key, entry);
        }
        let added = 0;
        for (const m of members) {
          if (!entry.members.has(m)) {
            entry.members.add(m);
            added++;
          }
        }
        return added;
      },
    ),

    sRem: jest.fn(
      async (key: string, ...members: string[]): Promise<number> => {
        const entry = sets.get(key);
        if (!entry || isExpired(entry.expiresAt)) return 0;
        let removed = 0;
        for (const m of members) {
          if (entry.members.delete(m)) removed++;
        }
        return removed;
      },
    ),

    sMembers: jest.fn(async (key: string): Promise<string[]> => {
      cleanExpired();
      const entry = sets.get(key);
      if (!entry || isExpired(entry.expiresAt)) return [];
      return [...entry.members];
    }),

    sCard: jest.fn(async (key: string): Promise<number> => {
      cleanExpired();
      const entry = sets.get(key);
      if (!entry || isExpired(entry.expiresAt)) return 0;
      return entry.members.size;
    }),

    // ─── Lua scripts ──────────────────────────────────
    scriptLoad: jest.fn(async (script: string): Promise<string> => {
      const sha = `mock-sha-${++scriptCounter}`;
      scripts.set(sha, script);
      return sha;
    }),

    evalSha: jest.fn(
      async (
        sha: string,
        _options: { keys: string[]; arguments: string[] },
      ): Promise<unknown> => {
        const script = scripts.get(sha);
        if (!script) throw new Error(`NOSCRIPT: ${sha}`);

        // Simulate Lua scripts based on SHA mapping
        // The actual behavior is driven by integration test setup
        // This provides a hook — tests should override evalSha for specific scenarios
        return [0, 0, 0];
      },
    ),

    // ─── Scan ─────────────────────────────────────────
    scan: jest.fn(
      async (
        cursor: number,
        options?: { MATCH?: string; COUNT?: number },
      ): Promise<{ cursor: number; keys: string[] }> => {
        cleanExpired();
        const pattern = options?.MATCH ?? '*';
        const regex = new RegExp(
          '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        );
        const allKeys = [
          ...strings.keys(),
          ...hashes.keys(),
          ...sets.keys(),
        ].filter((k) => regex.test(k));
        // Return all at once (single scan iteration)
        return { cursor: 0, keys: allKeys };
      },
    ),

    scanIterator: jest.fn(function* (options?: {
      MATCH?: string;
      COUNT?: number;
    }) {
      cleanExpired();
      const pattern = options?.MATCH ?? '*';
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      );
      const allKeys = [
        ...strings.keys(),
        ...hashes.keys(),
        ...sets.keys(),
      ].filter((k) => regex.test(k));
      for (const k of allKeys) {
        yield k;
      }
    }),

    ping: jest.fn(async (): Promise<string> => 'PONG'),

    multi: jest.fn(() => {
      const commands: Array<() => Promise<unknown>> = [];
      const chain = {
        exec: jest.fn(async () => {
          const results = [];
          for (const cmd of commands) {
            results.push((await cmd()) as never);
          }
          return results;
        }),
      };
      return chain;
    }),
  };

  return {
    client: client as unknown as Record<string, jest.Mock>,

    /** Advance simulated time by ms — causes TTL-based keys to expire */
    advanceTime(ms: number) {
      now += ms;
    },

    /** Get current simulated timestamp */
    getNow() {
      return now;
    },

    /** Set simulated timestamp explicitly */
    setNow(ts: number) {
      now = ts;
    },

    /** Reset all data and mocks */
    reset() {
      strings.clear();
      hashes.clear();
      sets.clear();
      scripts.clear();
      scriptCounter = 0;
      now = Date.now();
      for (const fn of Object.values(client)) {
        if (typeof fn === 'function' && 'mockClear' in fn) {
          (fn as jest.Mock).mockClear();
        }
      }
    },

    // Expose internals for assertions
    stores: { strings, hashes, sets, scripts },
  };
}
