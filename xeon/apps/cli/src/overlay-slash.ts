import {
  resolveSlashName,
  type ResolvedOverlay,
  type SlashCandidate,
  type SlashResolution,
} from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import { assertNever, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { HostConnection, OverlayRef } from "@fresnel/contracts/wire";
import { failureOfCaught, type Failure } from "./errors.ts";
import { EXIT } from "./exit-codes.ts";

// L4.cli.spec §4.12, review/m5/profile-project-loader.md §4.3.9. `/이름`을 플러그인 항목으로 풀어 turn.start의 overlay로 보낼 계획을 세운다.
// 엔진 명령과 내장 명령은 이 파일이 아니라 호출자가 먼저 가린다(slash.ts의 planSlashLine).

/** 한 페이지의 대화 수. thread.list의 상한이다 */
const THREAD_PAGE = 200;
/** 공통 묶음에서 온 플러그인의 사용처 표지(카드의 usedBy) */
const COMMON_USER = "common";

/** 계획에 쓰는 문맥. 세션의 연결과 지금 대화 id다(SlashContext와 같이 함수로 받는다, 대화를 바꾸면 다시 읽힌다) */
export interface OverlayContext {
  readonly connection: HostConnection;
  readonly supports: (feature: string) => boolean;
  readonly threadId: () => ThreadId;
}

/**
 * 입력 한 줄을 어떻게 보낼지. `send`는 덧씌우기 항목과 입력을 turn으로 보낸다. `notice`는 프로필에 이미 든 플러그인을
 * 덧씌우지 않았다는 안내다. `stop`은 아무것도 보내지 않고 `lines`를 안내한다(모호함, 입력 없음)
 */
export type OverlayPlan =
  | { readonly kind: "none" }
  | {
      readonly kind: "send";
      readonly input: string;
      readonly overlay: readonly OverlayRef[];
      readonly notice: string | null;
    }
  | { readonly kind: "stop"; readonly lines: readonly string[] };

/** 실패를 값으로 바꾼다. 오류 종류를 모르는 값은 그대로 다시 던진다(버그) */
export async function failureResult<T>(work: () => PromiseLike<T>): Promise<Result<T, Failure>> {
  const attempted = await attemptAsync(work);
  if (attempted.ok) return attempted;
  const failure = failureOfCaught(attempted.error.cause);
  if (failure === undefined) throw attempted.error.cause;
  return err(failure);
}

/** 대화가 속한 프로필 id. 프로필이 없는 대화는 `null`이다. 대화 목록에 없으면 실패다 */
export function profileIdOf(
  connection: HostConnection,
  threadId: ThreadId,
): Promise<Result<string | null, Failure>> {
  return findProfile(connection, threadId, undefined);
}

async function findProfile(
  connection: HostConnection,
  threadId: ThreadId,
  cursor: string | undefined,
): Promise<Result<string | null, Failure>> {
  const listed = await failureResult(() =>
    connection.request(
      "thread.list",
      cursor === undefined ? { limit: THREAD_PAGE } : { limit: THREAD_PAGE, cursor },
    ),
  );
  if (!listed.ok) return listed;
  const found = listed.value.threads.find((thread) => thread.threadId === threadId);
  if (found !== undefined) return ok(found.profileId ?? null);
  const next = listed.value.nextCursor;
  if (next === null) {
    return err({
      message: t("cli.errors.slash.profileUnknown.message"),
      fix: t("cli.errors.slash.profileUnknown.fix"),
      code: EXIT.error,
    });
  }
  return findProfile(connection, threadId, next);
}

/** 이 대화의 프로필(E(T))에 든 플러그인 이름 집합. 공통 묶음의 플러그인은 프로필이 없어도 든다 */
async function pluginSetOf(
  connection: HostConnection,
  profileId: string | null,
): Promise<Result<ReadonlySet<string>, Failure>> {
  const listed = await failureResult(() =>
    connection.request("plugin.list", profileId === null ? {} : { filter: { profileId } }),
  );
  if (!listed.ok) return listed;
  const names = listed.value.plugins
    .filter(
      (card) =>
        card.usedBy.includes(COMMON_USER) ||
        (profileId !== null && card.usedBy.includes(profileId)),
    )
    .map((card) => card.name);
  return ok(new Set(names));
}

/** 이름이 모호할 때 보이는 줄. 고를 수 있게 한정 이름으로 적는다 */
function ambiguousLines(name: string, candidates: readonly SlashCandidate[]): readonly string[] {
  return [
    t("cli.slash.overlay.ambiguous", { name }),
    ...candidates.map((candidate) => {
      const qualified =
        candidate.kind === "plugin"
          ? `/plugin:${candidate.plugin}`
          : `/${candidate.plugin}:${candidate.entry}`;
      return candidate.title.length === 0
        ? `  ${qualified}`
        : `  ${qualified}   ${candidate.title}`;
    }),
    t("cli.slash.overlay.ambiguousPick"),
  ];
}

function overlayRefOf(item: ResolvedOverlay): OverlayRef {
  return item.entry === undefined
    ? { plugin: item.plugin }
    : { plugin: item.plugin, entry: item.entry };
}

function firstTokenOf(line: string): string {
  const text = line.trim();
  return text.split(/\s+/)[0] ?? text;
}

function resolvedPlan(
  line: string,
  resolved: Extract<SlashResolution, { readonly kind: "resolved" }>,
): OverlayPlan {
  if (resolved.rest.length === 0) {
    return {
      kind: "stop",
      lines: [t("cli.slash.overlay.needsInput", { name: firstTokenOf(line) })],
    };
  }
  const fresh = resolved.overlay.filter((item) => !item.alreadyInProfile);
  const inProfile = resolved.overlay
    .filter((item) => item.alreadyInProfile)
    .map((item) => item.plugin);
  return {
    kind: "send",
    input: resolved.rest,
    overlay: fresh.map(overlayRefOf),
    notice:
      inProfile.length === 0
        ? null
        : t("cli.slash.overlay.inProfile", { names: inProfile.join(", ") }),
  };
}

/**
 * 엔진 명령도 내장 명령도 아닌 `/이름` 한 줄을 `plugin.invocables` 항목으로 푼다. 호스트가 그 목록을 모르면(오래된 엔진) 풀지 않는다(none).
 * 같은 이름이 여럿이면 `stop`으로 후보를 보인다. 이름만 적고 입력이 없으면 `stop`이다.
 */
export async function planOverlaySlash(
  line: string,
  ctx: OverlayContext,
): Promise<Result<OverlayPlan, Failure>> {
  if (!ctx.supports("plugin.invocables") || !ctx.supports("plugin.list")) {
    return ok({ kind: "none" });
  }
  const threadId = ctx.threadId();
  const profile = await profileIdOf(ctx.connection, threadId);
  if (!profile.ok) return profile;
  const inSet = await pluginSetOf(ctx.connection, profile.value);
  if (!inSet.ok) return inSet;
  const invocables = await failureResult(() =>
    ctx.connection.request("plugin.invocables", { threadId }),
  );
  if (!invocables.ok) return invocables;
  const resolved = resolveSlashName(line, invocables.value.entries, inSet.value);
  switch (resolved.kind) {
    case "none":
      return ok({ kind: "none" });
    case "ambiguous":
      return ok({ kind: "stop", lines: ambiguousLines(resolved.name, resolved.candidates) });
    case "resolved":
      return ok(resolvedPlan(line, resolved));
    default:
      return assertNever(resolved, "SlashResolution");
  }
}
