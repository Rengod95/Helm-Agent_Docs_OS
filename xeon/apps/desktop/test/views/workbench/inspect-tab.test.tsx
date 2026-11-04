import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { pickPlugin, selectedEntry, type HandlerFailureEntry } from "@fresnel/client/workbench";
import type { ExtTimingsResult } from "@fresnel/contracts/extensions";
import type {
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  GroupDriveLockResult,
  GroupStatusWire,
  Profile,
  SettingsExplainResult,
} from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  InspectBody,
  InspectTab,
  type InspectData,
} from "../../../src/views/workbench/inspect-tab.tsx";
import { entry, inContexts, screenStore } from "./support.tsx";

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

/** 구역(section)의 마크업 */
function sectionOf(html: string, title: string): string {
  const start = html.indexOf(`aria-label="${title}"`);
  if (start === -1) return "";
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? undefined : end);
}

const REVIEW = entry("review", { layer: "L3", isGroup: true, hookCount: 1 });
const WEB = entry("web", { displayName: "웹 검색" });

const QUIET: Profile = {
  id: "quiet",
  title: "조용히",
  enable: [],
  disable: ["web"],
  settings: [],
  driver: null,
  updatedAt: "2026-11-04T10:00:00Z",
  rev: 1,
};
const LOUD: Profile = { ...QUIET, id: "loud", title: "시끄럽게", disable: [], enable: ["web"] };

function detailOf(name: string, over: Partial<ExtGetResult> = {}): ExtGetResult {
  return {
    entry: entry(name),
    manifest: {},
    hooks: [],
    bindings: [],
    ...over,
  };
}

const TIMINGS: ExtTimingsResult = {
  traceEnabled: true,
  timings: [
    {
      hook: "tool.call.before",
      registrationId: "review",
      count: 3,
      p50Ms: 10,
      p95Ms: 60,
      maxMs: 90,
      failures: 2,
    },
  ],
};

const REVIEW_DETAIL = detailOf("review", {
  manifest: { composition: { blocks: [{ id: "lint", stage: "check", op: "on", title: "Lint" }] } },
  hooks: [
    { registrationId: "review", hook: "tool.call.before", budgetClass: "fast", budgetMs: 100 },
  ],
  bindings: [
    {
      registrationId: "review",
      capability: "web.search",
      relation: "requires",
      peer: null,
      satisfied: false,
    },
  ],
});

const WAITING: GroupStatusWire[] = [
  {
    id: "helm",
    displayName: "helm",
    scope: "enabled",
    pendingToggle: null,
    usesDrive: true,
    drive: "holder",
    lastError: null,
    metrics: null,
  },
  {
    id: "review",
    displayName: "review",
    scope: "enabled",
    pendingToggle: null,
    usesDrive: true,
    drive: "waiting",
    lastError: null,
    metrics: null,
  },
];

const LOCK: GroupDriveLockResult = {
  holder: "helm",
  leaseEpoch: 1,
  activeDriver: null,
  limits: { turns: 4, spawns: 4, tokens: null },
  used: { turns: 2, spawns: 0, tokens: 0 },
  candidates: [{ registrationId: "review", waits: 1, waitLimit: 3 }],
  lastRejected: null,
};

/** 대화를 열지 않은 기본 값: 프로필 목록은 비어 있다 */
const READY_DATA: InspectData = {
  detail: { kind: "ready", value: REVIEW_DETAIL },
  timings: { kind: "ready", value: TIMINGS },
  drive: { kind: "ready", value: { groups: WAITING, lock: LOCK } },
  settings: { kind: "ready", value: [] },
  profiles: { kind: "ready", value: [] },
};

function body(
  entryValue: ExtListEntry,
  data: InspectData,
  over: {
    readonly link?: "live" | "offline" | "pending";
    readonly health?: readonly ExtHealthEntry[];
    readonly records?: readonly HandlerFailureEntry[];
    readonly threadOpen?: boolean;
  } = {},
): string {
  return renderToString(
    <InspectBody
      entry={entryValue}
      pending={{}}
      link={over.link ?? "live"}
      data={data}
      health={over.health ?? []}
      records={over.records ?? []}
      threadOpen={over.threadOpen ?? false}
      onToggle={() => {}}
      onApplyProfile={() => {}}
      onReenable={() => {}}
      onDetail={() => {}}
    />,
  );
}

/** 단추 하나의 여는 태그와 글. 잠김 여부를 본다 */
function buttonOf(html: string, label: string): string {
  const end = html.indexOf(`>${label}</button>`);
  if (end === -1) return "";
  return html.slice(html.lastIndexOf("<button", end), end + label.length + "</button>".length + 1);
}

describe("검사 탭: 고른 것이 없으면 빈 상태", () => {
  test("고른 확장이 없으면 검사할 확장이 없다는 빈 상태를 그린다", () => {
    const html = renderToString(inContexts(<InspectTab />, screenStore()));
    expect(html).toContain(t("desktop.inspect.empty.title"));
    expect(html).toContain(t("desktop.inspect.empty.body"));
  });

  test("캔버스나 목록에서 고른 확장을 검사 탭이 읽는다(선택 값)", () => {
    const store = screenStore((s) => pickPlugin(s, "web"));
    expect(selectedEntry(store.actions.snapshot())?.name).toBe("web");
    const html = renderToString(inContexts(<InspectTab />, store));
    expect(html).not.toContain(t("desktop.inspect.empty.title"));
  });
});

describe("검사 탭 구역: 값이 있을 때", () => {
  test("훅 줄은 p95와 예산 막대(60/100 warning)와 실패 수를 보인다", () => {
    const hooks = sectionOf(body(REVIEW, READY_DATA), t("desktop.inspect.section.hooks") + " 1");
    expect(hooks).toContain(t("desktop.inspect.hook.p95", { ms: 60 }));
    expect(hooks).toContain('data-slot="meter"');
    expect(hooks).toContain('data-level="warning"');
    expect(hooks).toContain(t("desktop.inspect.hook.failures", { count: 2 }));
    expect(hooks).toContain("tool.call.before");
  });

  test("계측이 꺼져 있으면 p95 대신 계측 꺼짐 글을 보인다", () => {
    const html = body(REVIEW, {
      ...READY_DATA,
      timings: { kind: "ready", value: { traceEnabled: false, timings: [] } },
    });
    expect(html).toContain(t("desktop.inspect.hook.traceOff"));
    expect(html).not.toContain('data-slot="meter"');
  });

  test("요구 기능이 묶이지 않았으면 묶인 제공자 없음을 보인다", () => {
    const features = sectionOf(body(REVIEW, READY_DATA), t("desktop.inspect.features.title"));
    expect(textOf(features)).toContain("web.search");
    expect(features).toContain(t("desktop.inspect.features.unmet"));
  });

  test("그룹은 구성 블록을 보이고, drive를 쓰면 대기 역할과 대기 횟수를 보인다", () => {
    const html = body(REVIEW, READY_DATA);
    expect(sectionOf(html, t("desktop.inspect.composition.title"))).toContain("Lint");
    const lock = sectionOf(html, t("desktop.inspect.drive.title"));
    expect(lock).toContain(t("desktop.runtime.role.waiting"));
    expect(textOf(lock)).toContain(t("desktop.inspect.drive.waits", { waits: 1, waitLimit: 3 }));
  });

  test("설정 바인딩은 값과 이긴 범위를 보이고 시크릿은 값을 가린다", () => {
    const settings: SettingsExplainResult = {
      key: "ext.review.depth",
      value: 3,
      winningScope: "session",
      writer: "session",
    };
    const html = body(REVIEW, {
      ...READY_DATA,
      settings: {
        kind: "ready",
        value: [
          {
            key: "ext.review.depth",
            title: "깊이",
            value: "3",
            winningScope: settings.winningScope,
            writer: "session",
          },
          {
            key: "ext.review.key",
            title: "키",
            value: null,
            winningScope: null,
            writer: "default",
          },
        ],
      },
    });
    const section = sectionOf(html, t("desktop.inspect.settings.title"));
    expect(textOf(section)).toContain("깊이");
    expect(textOf(section)).toContain(
      t("desktop.inspect.settings.from", { scope: t("desktop.inspect.scope.session") }),
    );
    expect(textOf(section)).toContain(t("desktop.inspect.settings.hidden"));
    expect(textOf(section)).toContain(t("desktop.inspect.settings.default"));
  });

  test("최근 실패는 장부의 연속 실패와 기록의 훅·메시지를 보인다", () => {
    const html = body(REVIEW, READY_DATA, {
      health: [
        {
          name: "review",
          registrationId: "review",
          consecutiveFailures: 2,
          windowFailures: 2,
          windowMs: 0,
          autoDisabled: false,
          lastFailureAt: "2026-11-04T10:00:00Z",
          lastError: "timeout",
        },
      ],
      records: [
        {
          owner: "ext:review",
          point: "tool.call.before",
          result: "error",
          message: "boom",
          consecutive: 2,
        },
      ],
    });
    const failures = sectionOf(html, t("desktop.inspect.failures.title"));
    expect(textOf(failures)).toContain(t("desktop.inspect.failures.consecutive", { count: 2 }));
    expect(textOf(failures)).toContain("boom");
    expect(failures).toContain('data-slot="table"');
  });

  test("자동 꺼진 확장은 다시 켜기 단추를 보인다", () => {
    const off = entry("review", {
      layer: "L3",
      isGroup: true,
      status: "disabled",
      autoDisabled: true,
    });
    const html = body(off, READY_DATA);
    expect(html).toContain(t("desktop.workbench.reenable"));
  });
});

describe("검사 탭 상태: 읽는 중, 오류, 끊김, 대화 없음", () => {
  test("읽는 중이면 훅 구역에 Skeleton을 그린다", () => {
    const html = body(REVIEW, { ...READY_DATA, detail: { kind: "loading" } });
    expect(sectionOf(html, `${t("desktop.inspect.section.hooks")} 1`)).toContain(
      'data-slot="skeleton"',
    );
  });

  test("읽기가 실패하면 훅·기능·구성 구역이 같은 오류 한 줄을 보인다", () => {
    const html = body(REVIEW, { ...READY_DATA, detail: { kind: "error" } });
    expect(sectionOf(html, `${t("desktop.inspect.section.hooks")} 1`)).toContain(
      t("desktop.inspect.load.failed"),
    );
    expect(sectionOf(html, t("desktop.inspect.features.title"))).toContain(
      t("desktop.inspect.load.failed"),
    );
    expect(sectionOf(html, t("desktop.inspect.composition.title"))).toContain(
      t("desktop.inspect.load.failed"),
    );
  });

  test("엔진이 끊겼으면 검사 구역 대신 끊김 글 하나만 보인다", () => {
    const html = body(REVIEW, READY_DATA, { link: "offline" });
    expect(html).toContain(t("desktop.runtime.offline"));
    expect(html).not.toContain(`aria-label="${t("desktop.inspect.features.title")}"`);
  });

  test("대화가 없는 그룹은 주도 락 구역에 대화를 열라는 글을 보인다", () => {
    const html = body(REVIEW, {
      ...READY_DATA,
      drive: { kind: "idle" },
      settings: { kind: "idle" },
    });
    expect(sectionOf(html, t("desktop.inspect.drive.title"))).toContain(
      t("desktop.inspect.drive.noThread"),
    );
    expect(sectionOf(html, t("desktop.inspect.settings.title"))).toContain(
      t("desktop.inspect.settings.noThread"),
    );
  });

  test("그룹이 아닌 확장은 구성 구역과 주도 락 구역이 없다", () => {
    const html = body(WEB, { ...READY_DATA, drive: { kind: "idle" } });
    expect(html).not.toContain(`aria-label="${t("desktop.inspect.composition.title")}"`);
    expect(html).not.toContain(`aria-label="${t("desktop.inspect.drive.title")}"`);
  });
});

describe("검사 탭: 이 대화의 프로필", () => {
  test("열린 대화에서 프로필 고르기는 보이고, 고르기 전에는 적용이 잠긴다", () => {
    const html = body(
      WEB,
      { ...READY_DATA, profiles: { kind: "ready", value: [QUIET, LOUD] } },
      {
        threadOpen: true,
      },
    );
    const section = sectionOf(html, t("desktop.inspect.profile.title"));
    expect(textOf(section)).toContain(t("desktop.inspect.profile.select"));
    expect(textOf(section)).toContain(t("desktop.inspect.profile.pick"));
    expect(buttonOf(section, t("desktop.inspect.profile.apply"))).toContain('disabled=""');
    expect(section).not.toContain(t("desktop.inspect.profile.noThread"));
  });

  test("대화가 없으면 고르기와 적용이 잠기고 대화를 열라는 글을 보인다", () => {
    const html = body(
      WEB,
      { ...READY_DATA, profiles: { kind: "ready", value: [QUIET] } },
      {
        threadOpen: false,
      },
    );
    const section = sectionOf(html, t("desktop.inspect.profile.title"));
    expect(textOf(section)).toContain(t("desktop.inspect.profile.noThread"));
    expect(buttonOf(section, t("desktop.inspect.profile.apply"))).toContain('disabled=""');
    expect(section).toContain('disabled=""');
  });

  test("저장된 프로필이 없으면 빈 글을, 목록을 못 읽으면 오류 한 줄을 보인다", () => {
    const empty = body(WEB, READY_DATA, { threadOpen: true });
    expect(textOf(sectionOf(empty, t("desktop.inspect.profile.title")))).toContain(
      "저장된 프로필이 없어요.",
    );
    const failed = body(WEB, { ...READY_DATA, profiles: { kind: "error" } }, { threadOpen: true });
    expect(textOf(sectionOf(failed, t("desktop.inspect.profile.title")))).toContain(
      "프로필 목록을 읽지 못했어요.",
    );
  });
});
