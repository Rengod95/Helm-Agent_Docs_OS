import { describe, expect, test } from "bun:test";
import {
  STORE_FAILURE_KINDS,
  storeFailureKindOf,
  type MigrationError,
} from "../../src/records/index.ts";

// F.records.spec §3.7 저장소 열기 실패 분류 [결정: m2c G2-06]. 안내 문구와 복구 길이 다른 것을 나눈다.

describe("storeFailureKindOf", () => {
  test("a database newer than the app is told apart from a damaged one", () => {
    expect(storeFailureKindOf("migration_future_version")).toBe("future_version");
    expect(storeFailureKindOf("corrupt")).toBe("corrupt");
    expect(storeFailureKindOf("migration_checksum_mismatch")).toBe("corrupt");
    expect(storeFailureKindOf("migration_gap")).toBe("corrupt");
    expect(storeFailureKindOf("row_invalid")).toBe("corrupt");
  });

  test("a failed migration step has its own class, and environment problems stay unavailable", () => {
    expect(storeFailureKindOf("migration_failed")).toBe("migration_failed");
    for (const kind of [
      "busy",
      "disk_full",
      "io",
      "permission",
      "unsupported_filesystem",
      "db_path_invalid",
      "foreign_database",
      "fts5_missing",
      "something_new",
      "",
    ]) {
      expect({ kind, class: storeFailureKindOf(kind) }).toEqual({ kind, class: "unavailable" });
    }
  });

  test("every MigrationError kind maps to a class and none is left to the default by accident", () => {
    // MigrationError에 kind를 더하면 이 표를 먼저 고친다
    const expected: Readonly<Record<MigrationError["kind"], (typeof STORE_FAILURE_KINDS)[number]>> =
      {
        migration_checksum_mismatch: "corrupt",
        migration_future_version: "future_version",
        migration_gap: "corrupt",
        migration_failed: "migration_failed",
        busy: "unavailable",
        disk_full: "unavailable",
      };
    for (const [kind, klass] of Object.entries(expected)) {
      expect({ kind, class: storeFailureKindOf(kind) }).toEqual({ kind, class: klass });
    }
  });

  test("the class list is the four values the guidance distinguishes", () => {
    expect([...STORE_FAILURE_KINDS]).toEqual([
      "future_version",
      "corrupt",
      "migration_failed",
      "unavailable",
    ]);
  });
});
