import { describe, expect, test } from "bun:test";
import {
  LOCAL_ID_PREFIXES,
  LOCAL_ID_PREFIX_PATTERN,
  RESERVED_ID_PREFIXES,
  isLocalId,
  localIdPattern,
  type LocalIdPrefix,
} from "../../src/conversation/index.ts";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("local id prefixes", () => {
  const prefixes = Object.keys(LOCAL_ID_PREFIXES);

  test("every key is three lowercase letters", () => {
    const pattern = new RegExp(LOCAL_ID_PREFIX_PATTERN);
    for (const key of prefixes) expect(pattern.test(key)).toBe(true);
  });

  test("no key collides with a reserved prefix", () => {
    for (const key of prefixes) {
      expect(RESERVED_ID_PREFIXES.some((reserved) => reserved === key)).toBe(false);
    }
  });

  test("every prefix has an owner document", () => {
    for (const entry of Object.values(LOCAL_ID_PREFIXES)) {
      expect(entry.owner.length).toBeGreaterThan(0);
    }
  });
});

describe("local id patterns", () => {
  test("art accepts art_<ULID> and rejects lowercase ULID and two-letter prefixes", () => {
    const pattern = new RegExp(localIdPattern("art"));
    expect(pattern.test(`art_${ULID}`)).toBe(true);
    expect(pattern.test(`art_${ULID.toLowerCase()}`)).toBe(false);
    expect(pattern.test(`ar_${ULID}`)).toBe(false);
  });

  test("isLocalId checks prefix and ULID form", () => {
    const prefix: LocalIdPrefix = "sls";
    expect(isLocalId(prefix, `sls_${ULID}`)).toBe(true);
    expect(isLocalId(prefix, `bgp_${ULID}`)).toBe(false);
    expect(isLocalId(prefix, 3)).toBe(false);
  });
});
