import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { EnabledSource } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import {
  withEnabledSources,
  type EnabledSourceView,
} from "../../src/assembly/m4/enabled-source.ts";
import { createRecordedSources } from "../fixtures/ext-read-sources.ts";

// M5c §3.4 `ext.list.enabledSource`: 출처는 E(T)를 쥔 쪽이 정하고, 원천은 등록에서 확장 이름을 찾아 그 값을 쓴다.
// 정지 풀기(`ext.reenable`, `ext.disableConfirm`)는 원천을 부른 뒤 열린 대화의 E(T)를 다시 맞춘다.

const THREAD: ThreadId = fixedIdFactory().next("thr");

function viewOf(answers: Readonly<Record<string, EnabledSource>>): {
  readonly view: EnabledSourceView;
  readonly asked: string[];
  readonly recomputed: { count: number };
} {
  const asked: string[] = [];
  const recomputed = { count: 0 };
  return {
    asked,
    recomputed,
    view: {
      sourceOf: (threadId, extension) => {
        asked.push(`${threadId === undefined ? "-" : threadId}:${extension}`);
        return answers[extension] ?? "none";
      },
      recomputeAll: () => {
        recomputed.count += 1;
      },
      viewOf: () => ({ plugins: [], profileId: "default", profileRev: 0, commonRev: 0 }),
      viewOfProfile: () => undefined,
    },
  };
}

const REGISTRATIONS = [
  { id: "alpha", extension: "alpha" },
  { id: "team/scout", extension: "team" },
] as const;

test("enabledSource asks the plugin set about the registration's extension, for the thread or for none", () => {
  const { view, asked } = viewOf({ alpha: "core", team: "profile" });
  const sources = withEnabledSources(createRecordedSources().sources, view, () => REGISTRATIONS);
  expect(sources.enabledSource("alpha", THREAD)).toBe("core");
  expect(sources.enabledSource("team/scout", undefined)).toBe("profile");
  // 모양이 틀린 대화 id는 대화가 없는 것과 같다(다른 읽기와 같은 규칙): 기본 프로필의 출처를 본다
  expect(sources.enabledSource("team/scout", "not-a-thread")).toBe("profile");
  expect(sources.enabledSource("unknown", THREAD)).toBe("none");
  // 등록을 찾지 못하면 집합을 묻지 않는다
  expect(asked).toEqual([`${THREAD}:alpha`, "-:team", "-:team"]);
});

test("reenable and disableConfirm pass through to the source and then recompute the open threads", () => {
  const recorded = createRecordedSources();
  const { view, recomputed } = viewOf({});
  const sources = withEnabledSources(recorded.sources, view, () => REGISTRATIONS);
  sources.reenable("alpha");
  sources.disableConfirm("beta");
  expect(recorded.reenabled).toEqual(["alpha"]);
  expect(recorded.confirmed).toEqual(["beta"]);
  expect(recomputed.count).toBe(2);
});
