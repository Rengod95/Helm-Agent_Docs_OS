import { describe, expect, test } from "bun:test";
import { profileDraftOf, withChoice, type ProfileDraft } from "@fresnel/client/workbench";
import type { ExtListEntry, Profile } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  ChoiceRow,
  DriverField,
  TestRunButton,
} from "../../../src/views/compose/compose-profile.tsx";

// 프로필 보기의 서버 렌더. drive 그룹 고르기, 내장 코어의 잠금 줄, "새 Test run으로"의 잠김만 본다.
// 고르기의 목록은 순수 모델 `driverOptionsOf`가 시험하고, 여기서는 글과 잠김을 본다.

const NOOP = (): void => {};

function entryOf(name: string, over: Partial<ExtListEntry> = {}): ExtListEntry {
  return {
    name,
    displayName: name,
    layer: "L2",
    isGroup: false,
    version: "1.0.0",
    location: "/x",
    origin: "user",
    requestedGrade: "user",
    effectiveGrade: "user",
    tier: null,
    status: "enabled",
    plugins: [{ registrationId: name, layer: "L2", status: "enabled", inGroup: false }],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 2,
    ...over,
  };
}

const PROFILE: Profile = {
  id: "quiet",
  title: "조용히",
  enable: ["helm"],
  disable: [],
  settings: [],
  driver: null,
  updatedAt: "2026-11-04T10:00:00Z",
  rev: 2,
};

interface Btn {
  readonly label: string;
  readonly disabled: boolean;
}

function buttonsOf(html: string): readonly Btn[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    label: (match[2] ?? "").replace(/<[^>]+>/g, "").trim(),
    disabled: /\sdisabled(?=[\s=>])/.test(match[1] ?? ""),
  }));
}

function testRunOf(
  over: Partial<Parameters<typeof TestRunButton>[0]>,
  draft: ProfileDraft,
): string {
  return renderToString(
    <TestRunButton online busy={false} saved={PROFILE} draft={draft} onRun={NOOP} {...over} />,
  );
}

describe("drive 그룹 고르기", () => {
  // 닫힌 Select는 서버 렌더에 항목 글을 싣지 않는다. 항목 값(자동, 그룹, 저장된 이름)은 순수 모델 시험이 본다
  test("drive 그룹 칸의 글과 설명이 보인다", () => {
    const html = renderToString(
      <DriverField driver={null} choices={["helm", "lens"]} onChange={NOOP} />,
    );
    expect(html).toContain("drive 그룹");
    expect(html).toContain("바꾸면 적용 뒤 다음 경계에서 지금 drive 락을 회수해요");
  });
});

describe("확장 줄의 잠김", () => {
  test("내장 코어 줄은 잠김 글과 잠금 아이콘만 두고 켜기·끄기·그대로를 그리지 않는다", () => {
    const html = renderToString(
      <ul>
        <ChoiceRow
          entry={entryOf("core-loop", { tier: "core", origin: "builtin" })}
          choice="on"
          locked
          onChange={NOOP}
        />
      </ul>,
    );
    expect(html).toContain("core-loop");
    expect(html).toContain("잠김");
    expect(html).toContain("<svg");
    expect(html).not.toContain("켜기");
    expect(html).not.toContain("끄기");
    expect(html).not.toContain("그대로");
  });

  test("잠기지 않은 줄은 켜기·끄기·그대로를 그린다", () => {
    const html = renderToString(
      <ul>
        <ChoiceRow entry={entryOf("helm")} choice="keep" locked={false} onChange={NOOP} />
      </ul>,
    );
    expect(html).toContain("켜기");
    expect(html).toContain("끄기");
    expect(html).toContain("그대로");
    expect(html).not.toContain("잠김");
  });
});

describe("새 Test run으로", () => {
  test("저장된 프로필이고 바꾼 것이 없고 연결이 있으면 누를 수 있다", () => {
    const button = buttonsOf(testRunOf({}, profileDraftOf(PROFILE))).find(
      (item) => item.label === "새 Test run으로",
    );
    expect(button?.disabled).toBe(false);
  });

  test("연결이 없으면 잠긴다", () => {
    const button = buttonsOf(testRunOf({ online: false }, profileDraftOf(PROFILE))).find(
      (item) => item.label === "새 Test run으로",
    );
    expect(button?.disabled).toBe(true);
  });

  test("저장된 프로필이 없으면(새 프로필) 잠긴다", () => {
    const button = buttonsOf(testRunOf({ saved: null }, profileDraftOf(PROFILE))).find(
      (item) => item.label === "새 Test run으로",
    );
    expect(button?.disabled).toBe(true);
  });

  test("저장하지 않은 바꿈이 있으면 잠기고 저장하라는 줄이 보인다", () => {
    const draft = withChoice(profileDraftOf(PROFILE), "web", "on");
    const html = testRunOf({}, draft);
    const button = buttonsOf(html).find((item) => item.label === "새 Test run으로");
    expect(button?.disabled).toBe(true);
    expect(html).toContain("바꾼 내용을 저장한 뒤에 새 Test run으로 만들 수 있어요.");
  });
});
