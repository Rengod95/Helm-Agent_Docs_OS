import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { POINT_NAMES, POINTS } from "../../src/extensions/index.ts";

// F.extensions.spec §3.4 표와 POINTS를 대조한다(F.extensions.plan E9, 완료 기준 2).
// xeon/scripts의 검사 스크립트가 생기면 그쪽이 just verify에서 같은 일을 한다.
// 문서가 보이지 않는 곳(패키지만 복사된 경우)에서는 건너뛴다.
const SPEC = join(import.meta.dir, "../../../../../docs/xeon/F/extensions/spec.md");

interface DocRow {
  readonly n: number;
  readonly name: string;
  readonly kind: string;
  readonly fold: string;
  readonly onError: string;
  readonly m1: boolean;
  readonly def: string;
  readonly emit: string;
}

function docRows(text: string): DocRow[] {
  const rows: DocRow[] = [];
  for (const line of text.split("\n")) {
    // | 1 | `input` | input | chain | InputPayload | InputPatch | skip | ● | types.ts:... | runner.ts:... | ... |
    const cells = line.split("|").map((cell) => cell.trim());
    const [, n, name, kind, fold, , , onError, m1, def, emit] = cells;
    if (n === undefined || !/^\d+$/.test(n)) continue;
    if (name === undefined || !/^`[a-z_]+`$/.test(name)) continue;
    rows.push({
      n: Number(n),
      name: name.slice(1, -1),
      kind: kind ?? "",
      fold: fold ?? "",
      onError: onError ?? "",
      m1: m1 === "●",
      def: def ?? "",
      emit: emit ?? "",
    });
  }
  return rows;
}

describe("points doc table", () => {
  test.skipIf(!existsSync(SPEC))("name, kind, fold, failure, M1 and pi source match POINTS", () => {
    const rows = docRows(readFileSync(SPEC, "utf8"));
    expect(rows).toHaveLength(41);
    expect(rows.map((row) => row.n)).toEqual(Array.from({ length: 41 }, (_, i) => i + 1));
    expect(rows.map((row) => row.name)).toEqual([...POINT_NAMES]);
    for (const row of rows) {
      const code = POINT_NAMES.map((name) => POINTS[name]).find((decl) => decl.name === row.name);
      if (code === undefined) throw new Error(`no code row for ${row.name}`);
      expect({ name: row.name, kind: row.kind }).toEqual({ name: row.name, kind: code.kind });
      expect({ name: row.name, fold: row.fold }).toEqual({ name: row.name, fold: code.fold });
      expect({ name: row.name, onError: row.onError }).toEqual({
        name: row.name,
        onError: code.onError,
      });
      expect({ name: row.name, m1: row.m1 }).toEqual({ name: row.name, m1: code.m1 });
      expect({ name: row.name, def: row.def }).toEqual({ name: row.name, def: code.pi.def });
      expect({ name: row.name, emit: row.emit }).toEqual({ name: row.name, emit: code.pi.emit });
    }
  });
});
