import { describe, expect, test } from "bun:test";
import { isId, type TurnId } from "@fresnel/contracts/conversation";
import type { FileBefore } from "@fresnel/contracts/records";
import { decide, previewFileOf, type PlanEntry } from "../src/rewind/plan.ts";
import { isGitPath, matchesBefore, matchesSha, type CurrentFile } from "../src/rewind/files.ts";

// 되감기 판정 규칙의 값 표(파일 시스템을 쓰지 않는다). 순서가 뜻을 정한다: 옛 상태 저장 불가 → 거부 → 이미 원본 → 밖에서 바뀜.

const ORIGINAL_SHA = "a".repeat(64);
const AGENT_SHA = "b".repeat(64);
const OTHER_SHA = "c".repeat(64);

function turnIdOf(value: string): TurnId {
  if (!isId("trn", value)) throw new Error(`not a turn id: ${value}`);
  return value;
}

function saved(sha256: string): FileBefore {
  return { state: "saved", blob: { type: "blob", sha256, size: 3, mediaType: null }, mode: null };
}

const ABSENT: CurrentFile = { kind: "absent" };
const file = (sha256: string): CurrentFile => ({ kind: "file", bytes: new Uint8Array(), sha256 });

describe("restore decisions", () => {
  test("a file that matches the expected agent content is planned", () => {
    expect(decide(saved(ORIGINAL_SHA), AGENT_SHA, file(AGENT_SHA), false)).toEqual({
      outcome: "planned",
      reason: null,
    });
  });

  test("a file changed outside is kept, and a missing one says deleted_outside", () => {
    expect(decide(saved(ORIGINAL_SHA), AGENT_SHA, file(OTHER_SHA), false)).toEqual({
      outcome: "kept_changed",
      reason: "changed_outside",
    });
    expect(decide(saved(ORIGINAL_SHA), AGENT_SHA, ABSENT, false)).toEqual({
      outcome: "kept_changed",
      reason: "deleted_outside",
    });
  });

  test("a file already at its original state is skipped as already_original, even when it changed", () => {
    expect(decide(saved(ORIGINAL_SHA), AGENT_SHA, file(ORIGINAL_SHA), false)).toEqual({
      outcome: "skipped",
      reason: "already_original",
    });
    expect(decide({ state: "absent" }, AGENT_SHA, ABSENT, false)).toEqual({
      outcome: "skipped",
      reason: "already_original",
    });
  });

  test("a new file that changed after the agent wrote it is kept, and an unchanged one is planned for deletion", () => {
    expect(decide({ state: "absent" }, AGENT_SHA, file(OTHER_SHA), false)).toEqual({
      outcome: "kept_changed",
      reason: "changed_outside",
    });
    expect(decide({ state: "absent" }, AGENT_SHA, file(AGENT_SHA), false)).toEqual({
      outcome: "planned",
      reason: null,
    });
  });

  test("forced (overwrite) restores a changed file", () => {
    expect(decide(saved(ORIGINAL_SHA), AGENT_SHA, file(OTHER_SHA), true)).toEqual({
      outcome: "planned",
      reason: null,
    });
  });

  test("an original that was never saved is unrestorable, whatever the file looks like", () => {
    const unrestorable: FileBefore = { state: "unrestorable", reason: "too_large", size: 99 };
    expect(decide(unrestorable, AGENT_SHA, file(AGENT_SHA), false)).toEqual({
      outcome: "unrestorable",
      reason: "too_large",
    });
  });

  test("a path outside the allowed roots or unreadable is skipped with its reason", () => {
    expect(decide(saved(ORIGINAL_SHA), AGENT_SHA, { kind: "denied" }, false)).toEqual({
      outcome: "skipped",
      reason: "denied",
    });
    expect(decide(saved(ORIGINAL_SHA), AGENT_SHA, { kind: "unreadable" }, false)).toEqual({
      outcome: "skipped",
      reason: "unreadable",
    });
  });
});

describe("matching", () => {
  test("a saved original matches only its own hash, and an unrestorable one never matches", () => {
    expect(matchesBefore(file(ORIGINAL_SHA), saved(ORIGINAL_SHA))).toBe(true);
    expect(matchesBefore(file(OTHER_SHA), saved(ORIGINAL_SHA))).toBe(false);
    expect(matchesBefore(ABSENT, saved(ORIGINAL_SHA))).toBe(false);
    expect(
      matchesBefore(file(ORIGINAL_SHA), { state: "unrestorable", reason: "quota", size: 1 }),
    ).toBe(false);
  });

  test("a null expected hash means the file must be absent", () => {
    expect(matchesSha(ABSENT, null)).toBe(true);
    expect(matchesSha(file(AGENT_SHA), null)).toBe(false);
    expect(matchesSha(file(AGENT_SHA), AGENT_SHA)).toBe(true);
  });
});

describe("git paths", () => {
  test("any .git segment is a git path, a name that only contains .git is not", () => {
    expect(isGitPath("/work/repo/.git/config")).toBe(true);
    expect(isGitPath("/work/repo/.git")).toBe(true);
    expect(isGitPath("/work/repo/.gitignore")).toBe(false);
    expect(isGitPath("/work/git/notes.txt")).toBe(false);
  });
});

describe("preview reasons", () => {
  const base: Pick<PlanEntry, "path" | "turnId" | "expectedSha256" | "current"> = {
    path: "/work/a.txt",
    turnId: turnIdOf(`trn_${"0".repeat(25)}1`),
    expectedSha256: AGENT_SHA,
    current: ABSENT,
  };

  function entry(
    partial: Pick<PlanEntry, "outcome" | "reason" | "targetBefore" | "action">,
  ): PlanEntry {
    return { ...base, ...partial };
  }

  test("planned and kept entries map to restore, delete and keep", () => {
    expect(
      previewFileOf(
        entry({
          outcome: "planned",
          reason: null,
          targetBefore: saved(ORIGINAL_SHA),
          action: "restore",
        }),
      ).action,
    ).toBe("restore");
    expect(
      previewFileOf(
        entry({
          outcome: "kept_changed",
          reason: "deleted_outside",
          targetBefore: saved(ORIGINAL_SHA),
          action: "restore",
        }),
      ),
    ).toEqual({
      path: "/work/a.txt",
      action: "keep",
      reason: "deleted_outside",
      turnId: base.turnId,
    });
  });

  test("a skip reason outside the preview list is shown as no reason", () => {
    expect(
      previewFileOf(
        entry({
          outcome: "skipped",
          reason: "already_original",
          targetBefore: saved(ORIGINAL_SHA),
          action: "restore",
        }),
      ),
    ).toEqual({
      path: "/work/a.txt",
      action: "skip",
      reason: "already_original",
      turnId: base.turnId,
    });
    expect(
      previewFileOf(
        entry({
          outcome: "skipped",
          reason: "denied",
          targetBefore: saved(ORIGINAL_SHA),
          action: "restore",
        }),
      ),
    ).toEqual({ path: "/work/a.txt", action: "skip", reason: null, turnId: base.turnId });
  });

  test("an unrestorable original shows its reason", () => {
    expect(
      previewFileOf(
        entry({
          outcome: "unrestorable",
          reason: "quota",
          targetBefore: { state: "unrestorable", reason: "quota", size: 9 },
          action: "restore",
        }),
      ),
    ).toEqual({ path: "/work/a.txt", action: "skip", reason: "quota", turnId: base.turnId });
  });
});
