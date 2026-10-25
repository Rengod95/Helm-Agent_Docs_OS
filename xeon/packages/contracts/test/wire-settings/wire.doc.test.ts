import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WIRE_CLIENT_NOTIFICATIONS,
  WIRE_ERRORS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
} from "../../src/wire-settings/wire/index.ts";

// F.wire-settings.spec §3.3.1 메서드 표, §3.3.2 알림 표, §3.5.2 오류 표를 코드와 대조한다(F.wire-settings.plan W15).
// xeon/scripts의 검사 스크립트가 생기면 그쪽이 just verify에서 같은 일을 한다. 문서가 보이지 않는 곳에서는 건너뛴다.
const SPEC = join(import.meta.dir, "../../../../../docs/xeon/F/wire-settings/spec.md");

function section(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`section ${from} not found`);
  return text.slice(start, end);
}

function cells(line: string): string[] {
  return line.split("|").map((cell) => cell.trim());
}

describe("wire doc tables", () => {
  const text = existsSync(SPEC) ? readFileSync(SPEC, "utf8") : "";

  test.skipIf(!existsSync(SPEC))("method table matches registry", () => {
    const table = section(text, "#### 3.3.1 메서드 표", "#### 3.3.2 알림 표");
    const rows = table
      .split("\n")
      .map(cells)
      .filter((c) => /^`[a-z]+\.[A-Za-z]+`$/.test(c[2] ?? ""))
      .map((c) => ({
        name: (c[2] ?? "").slice(1, -1),
        // params 칸에 이스케이프한 "\|"가 있을 수 있어 단계는 마지막 칸에서 읽는다
        stage: c.findLast((cell) => cell !== "") ?? "",
      }));
    expect(rows).toHaveLength(29);
    expect(rows.map((r) => r.name).toSorted()).toEqual(Object.keys(WIRE_METHODS).toSorted());
    for (const row of rows) {
      const spec = Object.entries(WIRE_METHODS).find(([name]) => name === row.name)?.[1];
      const stage: string | undefined = spec?.stage;
      expect({ name: row.name, stage }).toEqual({ name: row.name, stage: row.stage });
    }
  });

  test.skipIf(!existsSync(SPEC))("notification table matches registries", () => {
    const table = section(text, "#### 3.3.2 알림 표", "#### 3.3.3 레지스트리 타입");
    const rows = table
      .split("\n")
      .map(cells)
      .filter((c) => /^`(\$\/)?[A-Za-z.]+`$/.test(c[2] ?? ""))
      .map((c) => ({ direction: c[1] ?? "", name: (c[2] ?? "").slice(1, -1), stage: c[4] ?? "" }));
    const server = rows.filter((r) => r.direction.startsWith("서버")).map((r) => [r.name, r.stage]);
    const client = rows
      .filter((r) => r.direction.startsWith("클라이언트"))
      .map((r) => [r.name, r.stage]);
    expect(server).toEqual(Object.entries(WIRE_NOTIFICATIONS).map(([n, s]) => [n, s.stage]));
    expect(client).toEqual(Object.entries(WIRE_CLIENT_NOTIFICATIONS).map(([n, s]) => [n, s.stage]));
  });

  test.skipIf(!existsSync(SPEC))("error table matches WIRE_ERRORS", () => {
    const table = section(text, "#### 3.5.2 M1 오류 목록", "#### 3.5.3 오류 코드 구간");
    const rows = table
      .split("\n")
      .map(cells)
      .filter((c) => /^-?\d+$/.test(c[1] ?? ""))
      .map((c) => ({
        code: Number(c[1]),
        kind: (c[2] ?? "").replaceAll("`", ""),
        retryable: c[3] === "true",
      }));
    expect(rows).toHaveLength(30);
    expect(rows).toEqual(
      Object.values(WIRE_ERRORS).map((s) => ({
        code: s.code,
        kind: s.kind,
        retryable: s.retryable,
      })),
    );
  });
});
