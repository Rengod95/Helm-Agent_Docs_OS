import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  CheckpointIdSchema,
  EffectIdSchema,
  EventIdSchema,
  ID_LENGTH,
  ItemIdSchema,
  PartIdSchema,
  StepIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
  idPattern,
  isId,
  type IdPrefix,
} from "../../src/conversation/index.ts";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const PREFIXES: readonly IdPrefix[] = ["thr", "trn", "stp", "itm", "prt", "evt", "efx", "ckp"];
const SCHEMAS = {
  thr: ThreadIdSchema,
  trn: TurnIdSchema,
  stp: StepIdSchema,
  itm: ItemIdSchema,
  prt: PartIdSchema,
  evt: EventIdSchema,
  efx: EffectIdSchema,
  ckp: CheckpointIdSchema,
} as const;

describe("id schemas: prefix", () => {
  for (const prefix of PREFIXES) {
    test(`${prefix} schema accepts only its own prefix`, () => {
      expect(parse(SCHEMAS[prefix], `${prefix}_${ULID}`).ok).toBe(true);
      for (const other of PREFIXES) {
        if (other !== prefix) expect(parse(SCHEMAS[prefix], `${other}_${ULID}`).ok).toBe(false);
      }
      expect(parse(SCHEMAS[prefix], ULID).ok).toBe(false);
      expect(parse(SCHEMAS[prefix], `${prefix.toUpperCase()}_${ULID}`).ok).toBe(false);
    });
  }
});

describe("id schemas: length and characters", () => {
  const schema = ThreadIdSchema;
  test("length 30 is the only valid length", () => {
    expect(`thr_${ULID}`.length).toBe(ID_LENGTH);
    expect(parse(schema, `thr_${ULID.slice(1)}`).ok).toBe(false);
    expect(parse(schema, `thr_${ULID}0`).ok).toBe(false);
  });

  test("lowercase ULID is rejected", () => {
    expect(parse(schema, `thr_${ULID.toLowerCase()}`).ok).toBe(false);
  });

  test("I, L, O, U are not Crockford base32", () => {
    for (const bad of ["I", "L", "O", "U"]) {
      expect(parse(schema, `thr_${ULID.slice(0, 25)}${bad}`).ok).toBe(false);
    }
  });

  test("first character above 7 is rejected", () => {
    expect(parse(schema, `thr_8${ULID.slice(1)}`).ok).toBe(false);
    expect(parse(schema, `thr_7${ULID.slice(1)}`).ok).toBe(true);
  });
});

describe("isId", () => {
  test("agrees with the schema and rejects non-strings", () => {
    const samples: unknown[] = [
      `thr_${ULID}`,
      `trn_${ULID}`,
      `thr_${ULID.toLowerCase()}`,
      "x",
      5,
      null,
    ];
    for (const value of samples) {
      expect(isId("thr", value)).toBe(parse(ThreadIdSchema, value).ok);
    }
    expect(isId("thr", 5)).toBe(false);
  });

  test("idPattern anchors the whole string", () => {
    expect(idPattern("evt")).toBe(`^evt_[0-7][0-9A-HJKMNP-TV-Z]{25}$`);
  });
});
