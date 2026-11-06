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

/** 글이 정확히 `label`인 단추 하나의 마크업(없으면 ""). "다시 켜기"와 "켜기"처럼 글이 겹쳐도 글 전체로 맞춘다 */
function buttonOf(html: string, label: string): string {
  const found = [...html.matchAll(/<button[\s\S]*?>([^<]*)<\/button>/g)].find(
    (m) => m[1] === label,
  );
  return found?.[0] ?? "";
}

const REVIEW = entry("review", { layer: "L3", isGroup: true, hookCount: 1 });
const WEB = entry("web", { displayName: "웹 검색" });

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

/** 기본 값 */
const READY_DATA: InspectData = {
  detail: { kind: "ready", value: REVIEW_DETAIL },
  timings: { kind: "ready", value: TIMINGS },
  drive: { kind: "ready", value: { groups: WAITING, lock: LOCK } },
  settings: { kind: "ready", value: [] },
};

function body(
  entryValue: ExtListEntry,
  data: InspectData,
  over: {
    readonly link?: "live" | "offline" | "pending";
    readonly health?: readonly ExtHealthEntry[];
    readonly records?: readonly HandlerFailureEntry[];
    readonly pending?: Readonly<Record<string, boolean>>;
  } = {},
): string {
  return renderToString(
    <InspectBody
      entry={entryValue}
      pending={over.pending ?? {}}
      link={over.link ?? "live"}
      data={data}
      health={over.health ?? []}
      records={over.records ?? []}
      onToggle={() => {}}
      onReenable={() => {}}
      onDetail={() => {}}
    />,
  );
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
  test("훅 줄은 훅 이름, fold 글, 예산, 예산 대비 막대와 퍼센트, p95, 실패 수를 보인다", () => {
    const hooks = sectionOf(body(REVIEW, READY_DATA), t("desktop.inspect.section.hooks"));
    const text = textOf(hooks);
    expect(text).toContain("tool.call.before");
    expect(text).toContain(t("desktop.inspect.fold.first"));
    expect(text).toContain(t("desktop.inspect.hook.budget", { ms: 100 }));
    expect(text).toContain(t("desktop.inspect.hook.p95", { ms: 60 }));
    expect(text).toContain("60%");
    expect(text).toContain(t("desktop.inspect.hook.failures", { count: 2 }));
    expect(hooks).toContain('data-slot="progress"');
    expect(hooks).toContain('data-tone="warning"');
    expect(text).toContain(t("desktop.inspect.section.count", { count: 1 }));
  });

  test("계측이 꺼져 있으면 막대 없이 측정 없음을 보이고, 이유는 정보 아이콘 뒤에 둔다", () => {
    const html = body(REVIEW, {
      ...READY_DATA,
      timings: { kind: "ready", value: { traceEnabled: false, timings: [] } },
    });
    const hooks = sectionOf(html, t("desktop.inspect.section.hooks"));
    expect(textOf(hooks)).toContain(t("desktop.inspect.hook.noMeasure"));
    expect(hooks).toContain(t("desktop.inspect.hook.traceOff"));
    expect(hooks).toContain(t("desktop.craft.infoTip.label"));
    expect(hooks).not.toContain('data-slot="progress"');
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

  test("주도 구역은 차수와 턴·하위 실행 사용량 막대를 보이고, 토큰 상한이 없으면 그렇게 적는다", () => {
    const lock = sectionOf(body(REVIEW, READY_DATA), t("desktop.inspect.drive.title"));
    expect(textOf(lock)).toContain(t("desktop.runtime.lock.epoch", { epoch: 1 }));
    expect(textOf(lock)).toContain("2 / 4");
    expect(textOf(lock)).toContain("0 / 4");
    expect(lock).toContain(t("desktop.inspect.drive.noLimit"));
    const capped = sectionOf(
      body(REVIEW, {
        ...READY_DATA,
        drive: {
          kind: "ready",
          value: {
            groups: WAITING,
            lock: {
              ...LOCK,
              limits: { ...LOCK.limits, tokens: 400 },
              used: { ...LOCK.used, tokens: 120 },
            },
          },
        },
      }),
      t("desktop.inspect.drive.title"),
    );
    expect(textOf(capped)).toContain("120 / 400");
    expect(capped).not.toContain(t("desktop.inspect.drive.noLimit"));
  });

  test("drive를 안 쓰는 그룹은 주도 구역을 그리지 않는다", () => {
    const noDrive: readonly GroupStatusWire[] = [
      {
        id: "review",
        displayName: "review",
        scope: "enabled",
        pendingToggle: null,
        usesDrive: false,
        drive: "none",
        lastError: null,
        metrics: null,
      },
    ];
    const html = body(REVIEW, {
      ...READY_DATA,
      drive: { kind: "ready", value: { groups: noDrive, lock: LOCK } },
    });
    expect(html).not.toContain(`aria-label="${t("desktop.inspect.drive.title")}"`);
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
    expect(textOf(section)).toContain("ext.review.depth");
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
    const text = textOf(failures);
    expect(text).toContain(t("desktop.inspect.failures.consecutive", { count: 2 }));
    expect(text).toContain(
      t("desktop.inspect.failures.last", { at: "2026-11-04T10:00:00Z", error: "timeout" }),
    );
    expect(text).toContain("tool.call.before");
    expect(text).toContain("boom");
    expect(text).toContain(t("desktop.inspect.failures.streak", { count: 2 }));
    expect(failures).not.toContain('data-slot="table"');
  });

  test("자동 꺼진 확장은 다시 켜기 단추를 보이고, 켜기·끄기 단추는 보이지 않는다", () => {
    const off = entry("review", {
      layer: "L3",
      isGroup: true,
      status: "disabled",
      autoDisabled: true,
    });
    const html = body(off, READY_DATA, {
      health: [
        {
          name: "review",
          registrationId: "review",
          consecutiveFailures: 5,
          windowFailures: 5,
          windowMs: 0,
          autoDisabled: true,
          lastFailureAt: null,
          lastError: null,
        },
      ],
    });
    expect(buttonOf(html, t("desktop.workbench.reenable"))).not.toBe("");
    expect(buttonOf(html, t("desktop.inspect.toggle.on"))).toBe("");
    expect(textOf(sectionOf(html, t("desktop.inspect.failures.title")))).toContain(
      t("desktop.inspect.failures.autoOff"),
    );
  });

  test("켜진 확장의 단추는 끄기이고, 꺼진 확장의 단추는 켜기다", () => {
    expect(buttonOf(body(REVIEW, READY_DATA), t("desktop.inspect.toggle.off"))).not.toBe("");
    const off = entry("review", { layer: "L3", isGroup: true, status: "disabled" });
    expect(buttonOf(body(off, READY_DATA), t("desktop.inspect.toggle.on"))).not.toBe("");
  });

  test("잠긴 확장(면제 tier)은 켜기·끄기 단추가 꺼지고 이유는 정보 아이콘 뒤에 있다", () => {
    const core = entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" });
    const html = body(core, READY_DATA);
    expect(buttonOf(html, t("desktop.inspect.toggle.off"))).toContain("disabled");
    expect(html).toContain(t("desktop.workbench.lock.exempt"));
    expect(html).toContain(t("desktop.craft.infoTip.label"));
  });

  test("요청이 기다리는 동안은 켜기·끄기 단추가 꺼진다", () => {
    const html = body(REVIEW, READY_DATA, { pending: { review: false } });
    expect(buttonOf(html, t("desktop.inspect.toggle.off"))).toContain("disabled");
  });

  test("머리는 표시 이름 옆에 mono id를 보이고, 확장 메뉴 단추를 둔다", () => {
    const html = body(WEB, READY_DATA);
    expect(textOf(html)).toContain("웹 검색");
    expect(textOf(html)).toContain("web");
    expect(html).toContain(t("desktop.inspect.menu.label"));
  });

  test("구성 선언이 없는 그룹은 구성 정보 없음을 보인다", () => {
    const html = body(REVIEW, {
      ...READY_DATA,
      detail: { kind: "ready", value: detailOf("review") },
    });
    expect(sectionOf(html, t("desktop.inspect.composition.title"))).toContain(
      t("desktop.inspect.composition.none"),
    );
  });
});

describe("검사 탭 상태: 읽는 중, 오류, 끊김, 대화 없음", () => {
  test("읽는 중이면 훅 구역에 Skeleton을 그린다", () => {
    const html = body(REVIEW, { ...READY_DATA, detail: { kind: "loading" } });
    expect(sectionOf(html, t("desktop.inspect.section.hooks"))).toContain('data-slot="skeleton"');
  });

  test("읽기가 실패하면 훅·기능·구성 구역이 같은 오류 한 줄을 보인다", () => {
    const html = body(REVIEW, { ...READY_DATA, detail: { kind: "error" } });
    expect(sectionOf(html, t("desktop.inspect.section.hooks"))).toContain(
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

describe("검사 탭: 이 대화의 프로필은 검사 탭에 없다", () => {
  test("프로필 구역은 검사 탭이 아니라 플러그인 탭에 있다", () => {
    const html = body(WEB, READY_DATA);
    expect(html).not.toContain(`aria-label="${t("desktop.inspect.profile.title")}"`);
  });
});
