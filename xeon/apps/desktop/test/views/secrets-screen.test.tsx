import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { err, parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import {
  submitKey,
  type KeyField,
  type KeyRegisterError,
  type KeyRegistrar,
} from "@fresnel/client/settings";
import type {
  SecretAuditEntry,
  SecretKeyStatusResult,
  SecretListEntry,
} from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { EngineStoreContext, type EngineMirror } from "../../src/state/engine/index.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { UsageLog } from "../../src/views/pages/secrets/secret-audit.tsx";
import {
  keyStoreViewOf,
  type KeyStoreRead,
  type KeyStoreView,
} from "../../src/views/pages/secrets/key-store-model.ts";
import { ValueStep } from "../../src/views/pages/secrets/secret-dialogs.tsx";
import { SecretDetail } from "../../src/views/pages/secrets/secret-detail.tsx";
import {
  initialSecretsState,
  secretsReducer,
  secretsViewOf,
  SEARCH_THRESHOLD,
  type SecretsState,
} from "../../src/views/pages/secrets/secret-model.ts";
import {
  SecretsScreenView,
  type SecretsScreenHandlers,
} from "../../src/views/pages/secrets/secrets-view.tsx";
import { harness, summary, thr } from "../state/helpers.ts";

// 시크릿 화면의 서버 렌더. 상태는 reducer로 만들고 동작 핸들러는 아무것도 하지 않는 것으로 둔다.
// 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 secret-model.test.ts가 본다). 값은 상태에 없고, 그릴 때 props로만 들어온다.

const NOOP = (): void => {};
const handlers: SecretsScreenHandlers = {
  add: NOOP,
  retry: NOOP,
  query: NOOP,
  sort: NOOP,
  select: NOOP,
  intent: NOOP,
  dismissNotice: NOOP,
  detail: {
    reveal: NOOP,
    hide: NOOP,
    copy: NOOP,
    changeValue: NOOP,
    editMeta: NOOP,
    test: NOOP,
    askRemove: NOOP,
  },
  entryName: NOOP,
  entryNext: NOOP,
  entrySubmit: NOOP,
  entryClose: NOOP,
  metaDraft: NOOP,
  metaSubmit: NOOP,
  metaClose: NOOP,
  removeConfirm: NOOP,
  removeClose: NOOP,
  keyStore: NOOP,
};

/** 열쇠 보관 위치의 가짜 값. 실제 경로가 아니다 */
const KEY_STATUS: SecretKeyStatusResult = {
  source: "auto",
  in: "keychain",
  filePath: "/fake/fresnel/secrets/age/keys.txt",
  keychainUsable: true,
  fallbackUnconfirmed: false,
  fileMissing: false,
};

/** 열쇠 보관 줄의 기본 그림. 위치를 읽고 옮기기는 하지 않은 상태다 */
const keyStore: KeyStoreView = keyStoreViewOf({
  read: { kind: "ready", status: KEY_STATUS },
  move: { kind: "idle" },
  remote: false,
  live: true,
});

const NOW = 1_800_000_000_000;
const SECRET_TEXT = "fake-secret-value-for-tests-0001";

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
}

const ROW: SecretListEntry = {
  name: nameOf("exa-api-key"),
  status: "valid",
  lastUsedAt: new Date(NOW - 2 * 60 * 1000).toISOString(),
  meta: {
    name: nameOf("exa-api-key"),
    desc: "search key",
    provider: "sops",
    ref: "dev/EXA",
    scope: "user",
    expiresAt: null,
    use: { modes: ["runtime-http"], tools: ["web.search"], hosts: ["api.exa.ai"] },
    approval: "none",
    ttlSeconds: 3600,
    maxUses: 50,
  },
};

/** 상태가 바뀌지 않는 스토어. 서버 렌더가 읽는 처음 상태가 곧 이 상태다 */
function frozenStore(state: EngineMirror): ReadonlyStore<EngineMirror> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function html(
  state: SecretsState,
  shownText: string | null = null,
  keyView: KeyStoreView = keyStore,
): string {
  // 독립 화면의 머리 펼치기 단추가 셸 스토어를 읽으므로 셸 provider 안에서 그린다
  return renderToString(
    <ShellStoreContext value={createShellStore(1400)}>
      <SecretsScreenView
        state={state}
        shownText={shownText}
        locale="ko"
        nowMs={NOW}
        handlers={handlers}
        keyStore={keyView}
      />
    </ShellStoreContext>,
  );
}

/** 오른쪽 시트 안의 상세. 시트는 서버 렌더에서 닫혀 있으므로 내용 부품을 바로 그린다. 고른 시크릿이 없으면 빈 글 */
function detailNode(state: SecretsState, shownText: string | null = null): ReactNode {
  const view = secretsViewOf(state);
  if (view.selected === null || view.detail === null) return null;
  return (
    <SecretDetail
      entry={view.selected}
      detail={view.detail}
      reveal={view.reveal}
      shownText={shownText}
      revealAvailable={view.revealAvailable}
      acting={view.acting}
      nowMs={NOW}
      locale="ko"
      sectionRef={{ current: null }}
      handlers={handlers.detail}
      onShowAllUsage={NOOP}
    />
  );
}

function detailHtml(state: SecretsState, shownText: string | null = null): string {
  return renderToString(detailNode(state, shownText));
}

function loadedWith(rows: readonly SecretListEntry[]): SecretsState {
  return secretsReducer(initialSecretsState(false), { type: "listLoaded", rows });
}

function withAudit(load: Parameters<typeof secretsReducer>[1] | null): SecretsState {
  const base = loadedWith([ROW]);
  return load === null ? base : secretsReducer(base, load);
}

describe("secrets screen server render", () => {
  test("an empty list that has loaded says there are no secrets and offers adding one", () => {
    const markup = html(loadedWith([]));
    expect(markup).toContain("등록된 시크릿이 없어요");
    expect(markup).toContain("추가");
    expect(markup).not.toContain('data-slot="skeleton"');
  });

  test("a list that is still loading shows the skeleton, not the empty state", () => {
    const markup = html(initialSecretsState(false));
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).not.toContain("등록된 시크릿이 없어요");
  });

  test("offline keeps the last list in view and says so", () => {
    const offline = secretsReducer(loadedWith([ROW]), {
      type: "listFailed",
      error: { kind: "offline" },
    });
    const markup = html(offline);
    expect(markup).toContain("연결이 끊겨 있어요");
    expect(markup).toContain("exa-api-key");
  });

  test("a failed read that is not offline names the cause and keeps the rows", () => {
    const failed = secretsReducer(loadedWith([ROW]), {
      type: "listFailed",
      error: { kind: "unsupported" },
    });
    const markup = html(failed);
    expect(markup).toContain("연결한 엔진이 시크릿을 아직 지원하지 않아요.");
    expect(markup).toContain("exa-api-key");
  });

  test("the selected value is masked and screen readers hear 값 가려짐, and the shipped gate says why it is locked", () => {
    const markup = detailHtml(loadedWith([ROW]));
    expect(markup).toContain("값 가려짐");
    expect(markup).toContain(
      "이 기기에서는 값 보기를 쓸 수 없어요: 기기 인증(Touch ID나 암호)이 필요해요",
    );
    expect(markup).not.toContain(SECRET_TEXT);
  });

  test("a revealed value is drawn from the prop with its countdown, and the state holds no text", () => {
    const revealed = secretsReducer(loadedWith([ROW]), {
      type: "reveal",
      view: { status: "revealed", name: ROW.name, hostShown: false, remainingSec: 20 },
    });
    const markup = detailHtml(revealed, SECRET_TEXT);
    expect(markup).toContain(SECRET_TEXT);
    expect(markup).toContain("20초 뒤 가려요");
    expect(JSON.stringify(revealed)).not.toContain(SECRET_TEXT);
  });

  test("past 50 rows the search and the sort appear", () => {
    const many: SecretListEntry[] = Array.from({ length: SEARCH_THRESHOLD + 1 }, (_, index) => ({
      name: nameOf(`key-${String(index).padStart(2, "0")}`),
      status: "valid",
    }));
    const markup = html(loadedWith(many));
    expect(markup).toContain("검색");
    expect(markup).toContain("정렬");
    const short = html(loadedWith([ROW]));
    expect(short).not.toContain("정렬");
  });

  describe("usage log (W-13)", () => {
    const AUDIT_ENTRIES: readonly SecretAuditEntry[] = [
      {
        at: new Date(NOW - 60 * 1000).toISOString(),
        decision: "deny",
        mode: "runtime-http",
        threadId: null,
        toolCallId: null,
        host: null,
        reason: "host_mismatch",
      },
      {
        at: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
        decision: "allow",
        mode: "env",
        threadId: null,
        toolCallId: "call_1",
        host: "api.exa.ai",
        reason: null,
      },
    ];

    test("a loaded log shows when, how, the host and the refusal reason, and no value", () => {
      const markup = detailHtml(
        withAudit({
          type: "audit",
          name: ROW.name,
          load: { kind: "ready", value: { entries: [...AUDIT_ENTRIES] } },
        }),
      );
      expect(markup).toContain("최근 사용");
      expect(markup).toContain("요청 헤더");
      expect(markup).toContain("허용하지 않은 호스트");
      expect(markup).toContain("거절");
      expect(markup).toContain("환경 변수 · api.exa.ai");
      expect(markup).toContain("썼어요");
      expect(markup).toContain("대화 없음");
      expect(markup).not.toContain(SECRET_TEXT);
    });

    test("an empty log, a loading log and a failed log each say what they are", () => {
      const empty = detailHtml(
        withAudit({
          type: "audit",
          name: ROW.name,
          load: { kind: "ready", value: { entries: [] } },
        }),
      );
      expect(empty).toContain("아직 쓴 기록이 없어요.");
      const loading = detailHtml(
        withAudit({ type: "audit", name: ROW.name, load: { kind: "loading" } }),
      );
      expect(loading).toContain("사용 기록을 불러오는 중이에요.");
      const failed = detailHtml(
        withAudit({
          type: "audit",
          name: ROW.name,
          load: { kind: "failed", error: { kind: "unsupported" } },
        }),
      );
      expect(failed).toContain("연결한 엔진이 시크릿을 아직 지원하지 않아요.");
    });

    test("the sheet shows the latest five with 모두 보기; the full log pages by 50 and offers the rest", () => {
      const many: SecretAuditEntry[] = Array.from({ length: 120 }, (_, index) => ({
        at: new Date(NOW - (index + 1) * 1000).toISOString(),
        decision: "allow",
        mode: "env",
        threadId: null,
        toolCallId: `call_${index}`,
        host: null,
        reason: null,
      }));
      const markup = detailHtml(
        withAudit({
          type: "audit",
          name: ROW.name,
          load: { kind: "ready", value: { entries: many } },
        }),
      );
      expect(markup.match(/data-slot="audit-row"/g)?.length).toBe(5);
      expect(markup).toContain("모두 보기");
      const full = renderToString(
        <UsageLog audit={{ kind: "ready", value: { entries: many } }} nowMs={NOW} locale="ko" />,
      );
      expect(full.match(/data-slot="audit-row"/g)?.length).toBe(50);
      expect(full).toContain("더 보기 (70개 남음)");
    });

    test("a conversation row names the conversation by its title, 제목 없음 when it has none, and a short id when the list does not know it", () => {
      const h = harness();
      h.store.ingest({
        type: "threads",
        threads: [summary(thr(1), { title: "캐시 무효화 조사" }), summary(thr(2), { title: null })],
      });
      h.store.flush();
      const state = withAudit({
        type: "audit",
        name: ROW.name,
        load: {
          kind: "ready",
          value: {
            entries: [1, 2, 3].map((n, index) => ({
              at: new Date(NOW - (index + 1) * 1000).toISOString(),
              decision: "allow",
              mode: "env",
              threadId: thr(n),
              toolCallId: `call_${n}`,
              host: "api.exa.ai",
              reason: null,
            })),
          },
        },
      });
      // 서버 렌더는 스토어의 처음 상태를 읽으므로(zustand getInitialState) 시드한 거울을 고정 스토어로 준다
      const mirror = h.store.read.getState();
      const markup = renderToString(
        <EngineStoreContext value={frozenStore(mirror)}>
          <ShellStoreContext value={createShellStore(1400)}>{detailNode(state)}</ShellStoreContext>
        </EngineStoreContext>,
      );
      expect(markup).toContain("캐시 무효화 조사");
      expect(markup).toContain("제목 없음");
      expect(markup).toContain("thr_…000003");
      expect(markup).not.toContain(thr(1));
      expect(markup).not.toContain(thr(2));
      expect(markup).not.toContain(thr(3));
    });

    test("a log for another name does not change the selected detail", () => {
      const state = withAudit({
        type: "audit",
        name: nameOf("other-key"),
        load: { kind: "ready", value: { entries: [...AUDIT_ENTRIES] } },
      });
      expect(state.detail?.audit.kind).toBe("idle");
      expect(detailHtml(state)).not.toContain("허용하지 않은 호스트");
    });
  });
});

/** 입력 칸 하나. `take()`가 읽는 즉시 비운다(화면의 규칙과 같다) */
function typedField(initial: string): { readonly field: KeyField; readonly shown: () => string } {
  let value = initial;
  return {
    field: {
      take: () => {
        const typed = value;
        value = "";
        return typed;
      },
    },
    shown: () => value,
  };
}

/** 열쇠 보관 줄을 바꾼 그림. 목록은 빈 상태로 둔다 */
const SHOWN = (state: SecretsState, view: KeyStoreView): string => html(state, null, view);
/** 위치를 읽은 상태 */
const readOf = (status: SecretKeyStatusResult): KeyStoreRead => ({ kind: "ready", status });

describe("the key store line above the table", () => {
  test("shows the line with its two choices and the meaning of each, even with no secret yet", () => {
    const out = html(initialSecretsState(false));
    expect(out).toContain(t("desktop.secrets.keyStore.title"));
    expect(out).toContain(t("desktop.secrets.keyStore.keychain"));
    expect(out).toContain(t("desktop.secrets.keyStore.file"));
    expect(out).toContain(t("desktop.secrets.keyStore.info.keychain"));
    expect(out).toContain(t("desktop.secrets.keyStore.info.file"));
  });

  test("says where the key is, with the app file's path", () => {
    const view = keyStoreViewOf({
      read: readOf({ ...KEY_STATUS, in: "file" }),
      move: { kind: "idle" },
      remote: false,
      live: true,
    });
    const out = SHOWN(initialSecretsState(false), view);
    expect(out).toContain(t("desktop.secrets.keyStore.inFile", { path: KEY_STATUS.filePath }));
  });

  test("says there is no key yet when none is stored", () => {
    const view = keyStoreViewOf({
      read: readOf({ ...KEY_STATUS, in: "none" }),
      move: { kind: "idle" },
      remote: false,
      live: true,
    });
    expect(SHOWN(initialSecretsState(false), view)).toContain(t("desktop.secrets.keyStore.none"));
  });

  test("a setting that points at a missing key file warns in danger with the path", () => {
    const view = keyStoreViewOf({
      read: readOf({ ...KEY_STATUS, in: "none", fileMissing: true }),
      move: { kind: "idle" },
      remote: false,
      live: true,
    });
    expect(SHOWN(initialSecretsState(false), view)).toContain(
      t("desktop.secrets.keyStore.fileMissing", { path: KEY_STATUS.filePath }),
    );
  });

  test("a remote screen reads the line only and says it can change only on this computer", () => {
    const view = keyStoreViewOf({
      read: readOf(KEY_STATUS),
      move: { kind: "idle" },
      remote: true,
      live: true,
    });
    const out = SHOWN(initialSecretsState(false), view);
    expect(out).toContain(t("desktop.secrets.keyStore.readOnly"));
    expect(out).toContain('aria-disabled="true"');
  });
});

describe("entry failure sentences on the value step", () => {
  const FAKE_KEY = "fake-key-for-tests-0002";
  const ESCAPES: Readonly<Record<string, string>> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
  };
  /** 그려진 HTML에서 글이 어떤 모양인지. React가 글을 이렇게 바꿔 쓴다 */
  const escaped = (text: string): string => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

  const CASES: readonly {
    readonly label: string;
    readonly error: KeyRegisterError;
    readonly cause: string;
    /** 고치는 법 한 줄. 시간 초과는 원인 문장 안에 고치는 법이 들어 있어 따로 없다 */
    readonly fix: string | null;
  }[] = [
    {
      label: "service_local_only",
      error: { kind: "rejected", exitCode: 1, code: "service_local_only", detail: "" },
      cause: "이 컴퓨터에서만 값을 넣을 수 있어요",
      fix: "값을 넣을 컴퓨터의 앱에서 등록하거나 그 컴퓨터에서 `fresnel secret add <이름>`을 실행해요",
    },
    {
      label: "key_store",
      error: { kind: "rejected", exitCode: 1, code: "key_store", detail: "" },
      cause: "OS 키 저장소를 쓸 수 없어요",
      fix: "키 저장소 잠금을 풀거나 설정의 시크릿에서 열쇠 보관을 '앱 파일'로 바꿔요",
    },
    {
      label: "already_exists",
      error: { kind: "rejected", exitCode: 1, code: "already_exists", detail: "" },
      cause: "이미 있는 이름이에요",
      fix: "값만 바꾸려면 '값 바꾸기'를 써요",
    },
    {
      label: "value_too_short",
      error: { kind: "rejected", exitCode: 1, code: "value_too_short", detail: "" },
      cause: "값이 너무 짧아요(8자 이상)",
      fix: "키 전체를 붙여 넣었는지 확인해요",
    },
    {
      label: "sops_missing",
      error: { kind: "rejected", exitCode: 1, code: "sops_missing", detail: "" },
      cause: "sops가 없어요",
      fix: "sops 3.10 이상을 설치해요",
    },
    {
      label: "timeout",
      error: { kind: "timeout" },
      cause: "키 등록이 시간 안에 끝나지 않았어요. 다시 시도해 주세요.",
      fix: null,
    },
  ];

  for (const row of CASES) {
    test(`${row.label}: the cause and its fix are on the step, the field is empty, and the value is not drawn`, async () => {
      const typed = typedField(FAKE_KEY);
      const registrar: KeyRegistrar = {
        registerKey: () => Promise.resolve(err(row.error)),
      };
      const outcome = await submitKey(registrar, nameOf("exa-api-key"), "add", typed.field);
      if (outcome.kind !== "failed") throw new Error("a rejected registration is a failure");
      expect(outcome.text).toBe(row.cause);
      expect(outcome.fix ?? null).toBe(row.fix);
      expect(typed.shown()).toBe("");
      const markup = renderToString(
        <ValueStep
          busy={false}
          error={{ text: outcome.text, ...(outcome.fix === undefined ? {} : { fix: outcome.fix }) }}
          onSubmit={NOOP}
          onCancel={NOOP}
        />,
      );
      expect(markup).toContain(escaped(row.cause));
      if (row.fix !== null) expect(markup).toContain(escaped(row.fix));
      expect(markup).not.toContain(FAKE_KEY);
    });
  }
});
