import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type { SecretAuditEntry, SecretListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  initialSecretsState,
  secretsReducer,
  SEARCH_THRESHOLD,
  type SecretsState,
} from "../../src/views/pages/secrets/secret-model.ts";
import {
  SecretsScreenView,
  type SecretsScreenHandlers,
} from "../../src/views/pages/secrets/secrets-view.tsx";

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
};

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

function html(state: SecretsState, shownText: string | null = null): string {
  return renderToString(
    <SecretsScreenView
      state={state}
      shownText={shownText}
      locale="ko"
      nowMs={NOW}
      handlers={handlers}
    />,
  );
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
    const markup = html(loadedWith([ROW]));
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
    const markup = html(revealed, SECRET_TEXT);
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
      const markup = html(
        withAudit({
          type: "audit",
          name: ROW.name,
          load: { kind: "ready", value: { entries: [...AUDIT_ENTRIES] } },
        }),
      );
      expect(markup).toContain("사용 기록");
      expect(markup).toContain("요청 헤더");
      expect(markup).toContain("허용하지 않은 호스트");
      expect(markup).toContain("거절");
      expect(markup).toContain("환경 변수 · api.exa.ai");
      expect(markup).toContain("썼어요");
      expect(markup).toContain("대화 없음");
      expect(markup).not.toContain(SECRET_TEXT);
    });

    test("an empty log, a loading log and a failed log each say what they are", () => {
      const empty = html(
        withAudit({
          type: "audit",
          name: ROW.name,
          load: { kind: "ready", value: { entries: [] } },
        }),
      );
      expect(empty).toContain("아직 쓴 기록이 없어요.");
      const loading = html(withAudit({ type: "audit", name: ROW.name, load: { kind: "loading" } }));
      expect(loading).toContain("사용 기록을 불러오는 중이에요.");
      const failed = html(
        withAudit({
          type: "audit",
          name: ROW.name,
          load: { kind: "failed", error: { kind: "unsupported" } },
        }),
      );
      expect(failed).toContain("연결한 엔진이 시크릿을 아직 지원하지 않아요.");
    });

    test("a log longer than one page draws the first 50 rows and offers the rest", () => {
      const many: SecretAuditEntry[] = Array.from({ length: 120 }, (_, index) => ({
        at: new Date(NOW - (index + 1) * 1000).toISOString(),
        decision: "allow",
        mode: "env",
        threadId: null,
        toolCallId: `call_${index}`,
        host: null,
        reason: null,
      }));
      const markup = html(
        withAudit({
          type: "audit",
          name: ROW.name,
          load: { kind: "ready", value: { entries: many } },
        }),
      );
      expect(markup.match(/<li /g)?.length).toBe(50);
      expect(markup).toContain("더 보기 (70개 남음)");
    });

    test("a log for another name does not change the selected detail", () => {
      const state = withAudit({
        type: "audit",
        name: nameOf("other-key"),
        load: { kind: "ready", value: { entries: [...AUDIT_ENTRIES] } },
      });
      expect(state.detail?.audit.kind).toBe("idle");
      expect(html(state)).not.toContain("사용 기록");
    });
  });
});
