import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertNever,
  attemptAsync,
  err,
  ok,
  parse,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import { ExtensionNameSchema } from "@fresnel/contracts/extensions";
import {
  failure,
  type KnowledgeFailure,
  type UserSkillSink,
  type UserSkillSubmission,
  type UserSkillSubmitted,
} from "@fresnel/cap-knowledge";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";
import { COMMON_ID } from "../m4/plugin-edit.ts";
import type { ReviewDecision } from "@fresnel/contracts/wire";
import type { IntakeRequest, PluginDraftIntake } from "./intake.ts";

// 사용자 범위 스킬 만들기의 검토 싱크(L4 조립, L2.knowledge §7.5 [제안]). 스킬 폴더 하나(`<이름>/SKILL.md`)를 임시 폴더에 쓰고
// 공유 입구(`intake`)로 검토 항목을 만든다. 사람이 이미 승인한 만들기는 같은 호출에서 공통 묶음에 든 승인본이 된다(사람의 결정 [제안]).
// 적재가 아니다: 승인본은 처음 대화의 집합에 들 때 읽힌다(§4.1.11). 임시 폴더는 입구가 복사를 마친 뒤 지운다.

const STAGE_PREFIX = "fresnel-skill-";
/** 설명을 승인 목적 한 문장으로 쓸 때의 글자 상한(매니페스트 `purpose`와 같다) */
const PURPOSE_MAX_CHARS = 200;
/** 매니페스트 위치(폴더 기준). 지침 한 줄 초안과 같은 자리다 */
const MANIFEST_PATH = join(".fresnel-plugin", "plugin.json");
/** 스킬 플러그인의 매니페스트 버전. 같은 이름의 새 버전도 이 값이고 내용 해시로 구별한다(지침 플러그인과 같다 [제안]) */
const SKILL_PLUGIN_VERSION = "0.0.0";

/**
 * 검토 서비스의 입구와 승인만 쓴다. 승인 결과의 내용은 보지 않으므로 값은 `unknown`이다(시험이 가짜를 넣기 쉽다)
 */
export interface UserSkillSinkDeps {
  readonly intake: Pick<PluginDraftIntake, "submit">;
  readonly decide: (
    itemId: string,
    decision: ReviewDecision,
  ) => Promise<Result<unknown, PluginPortFailure>>;
  readonly log: Logger;
}

export function createUserSkillSink(deps: UserSkillSinkDeps): UserSkillSink {
  return {
    submit: (input) => submitStaged(input, deps),
  };
}

async function submitStaged(
  input: UserSkillSubmission,
  deps: UserSkillSinkDeps,
): Promise<Result<UserSkillSubmitted, KnowledgeFailure>> {
  // 플러그인 이름은 확장 이름 규칙을 따른다(2~32자, 소문자로 시작). 스킬 이름이 그 규칙에 맞지 않으면 검토할 수 없다
  const pluginName = parse(ExtensionNameSchema, input.name);
  if (!pluginName.ok) {
    return err(
      failure(
        "invalid_input",
        `skill ${input.name} cannot become a plugin: a plugin name is 2 to 32 lowercase letters, digits or hyphens, starting with a letter`,
      ),
    );
  }
  const stage = await attemptAsync(() => mkdtemp(join(tmpdir(), STAGE_PREFIX)));
  if (!stage.ok) {
    return err(
      failure("unavailable", "the staging folder for the skill draft could not be made", {
        cause: stage.error,
      }),
    );
  }
  const dir = join(stage.value, pluginName.value);
  const written = await writeFolder(dir, input);
  const result = written.ok ? await admit(dir, input, deps) : written;
  const removed = await attemptAsync(() => rm(stage.value, { recursive: true, force: true }));
  if (!removed.ok) deps.log.warn("knowledge.skill_stage_remove_failed", { name: input.name });
  return result;
}

/**
 * 플러그인 폴더를 쓴다: 스킬 파일과 최소 매니페스트(이름, 버전, 목적). 매니페스트가 있어야 이름이 폴더 이름(스테이징의 `tree`)이 아니라
 * 스킬 이름이 된다. 매니페스트가 없는 폴더는 검토 입구가 `tree`라는 이름을 붙인다(`review.ts`의 `proposeItem`이 스냅샷 폴더 이름을 쓴다)
 */
async function writeFolder(
  dir: string,
  input: UserSkillSubmission,
): Promise<Result<void, KnowledgeFailure>> {
  const manifest = `${JSON.stringify(
    {
      schemaVersion: 2,
      name: input.name,
      version: SKILL_PLUGIN_VERSION,
      purpose: capPurpose(input.description),
    },
    null,
    2,
  )}\n`;
  const written = await attemptAsync(async () => {
    await mkdir(join(dir, dirname(MANIFEST_PATH)), { recursive: true });
    await writeFile(join(dir, MANIFEST_PATH), manifest, "utf8");
    await Promise.all(
      input.files.map(async (file) => {
        const target = join(dir, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes);
      }),
    );
  });
  return written.ok
    ? ok(undefined)
    : err(
        failure("unavailable", "the skill draft folder could not be written", {
          cause: written.error,
        }),
      );
}

/**
 * 입구에 넘길 요청. 담당 AI가 대화 안에서 만든 것이면 `assistant`(대화와 turn 증거가 있다), 아니면 `user_instruction`이다.
 * 사람이 이미 승인한 만들기는 대화를 출처로 적지 않는다: 승인 대상은 학습 제안이나 사용자 행위라 만든 대화가 아니다 [제안]
 */
function requestOf(dir: string, input: UserSkillSubmission): IntakeRequest {
  const purpose = capPurpose(input.description);
  const threadId = input.threadId;
  const turnId = input.turnId;
  if (
    !input.approvedByUser &&
    input.actor.kind === "agent" &&
    threadId !== undefined &&
    turnId !== undefined
  ) {
    return {
      dir,
      provenance: "assistant",
      originThreadId: threadId,
      evidence: [{ kind: "turn", threadId, turnId }],
      purpose,
    };
  }
  return { dir, provenance: "user_instruction", originThreadId: null, evidence: [], purpose };
}

/** 목적 한 문장: 줄바꿈을 공백으로 바꾸고 글자(코드 포인트) 상한을 지킨다 */
function capPurpose(text: string): string {
  return Array.from(text.replace(/\s+/g, " ")).slice(0, PURPOSE_MAX_CHARS).join("").trim();
}

async function admit(
  dir: string,
  input: UserSkillSubmission,
  deps: UserSkillSinkDeps,
): Promise<Result<UserSkillSubmitted, KnowledgeFailure>> {
  const made = await deps.intake.submit(requestOf(dir, input));
  if (!made.ok) return err(failureOfPlugin(made.error));
  const itemId = made.value.itemId;
  if (!input.approvedByUser) return ok({ itemId, approved: false });
  // 사람이 이미 승인한 만들기: 같은 호출에서 공통 묶음에 든 승인본으로 만든다. 사용자 행위자로 기록된다(검토 로그의 기본값)
  const decided = await deps.decide(itemId, {
    kind: "approve",
    profileIds: [COMMON_ID],
    libraryOnly: false,
  });
  if (!decided.ok) {
    deps.log.warn("knowledge.skill_review_approve_failed", { itemId, kind: decided.error.kind });
    return err(
      failure(
        "unavailable",
        `the skill draft is in the plugin review inbox as ${itemId} but was not approved: ${decided.error.kind}`,
        { detail: { reviewItemId: itemId } },
      ),
    );
  }
  return ok({ itemId, approved: true });
}

/** 검토 서비스의 실패를 cap-knowledge의 실패로 옮긴다. 메시지에는 원본 파일 내용이 없다 */
function failureOfPlugin(error: PluginPortFailure): KnowledgeFailure {
  switch (error.kind) {
    case "unknown_plugin":
    case "thread_not_found":
    case "no_reviewed_copy":
    case "draft_not_found":
    case "review_not_found":
      return failure("not_found", `plugin review: ${error.kind}`);
    case "profiles":
      return failure("unavailable", `plugin review profiles: ${error.failure.kind}`);
    case "store":
      return failure("unavailable", `plugin review store: ${error.code}`);
    case "draft_invalid":
      return failure("invalid_input", "the skill draft is not a valid plugin folder");
    case "exists":
      return failure("name_conflict", `a plugin named ${error.name} already exists`);
    case "too_large":
      return failure("limit_exceeded", "the skill draft is too large");
    case "symlink_refused":
      return failure("denied", "the skill draft folder contains a symbolic link");
    case "not_pending":
      return failure("internal", `plugin review item ${error.itemId} is not pending`);
    case "path_invalid":
      return failure("invalid_input", "the skill draft path is outside the snapshot");
    case "hand_edit":
      return failure(
        "denied",
        `plugin review item ${error.itemId} is a hand edit and cannot be approved`,
      );
    case "purpose_required":
      return failure("invalid_input", `plugin review item ${error.itemId} has no purpose`);
    case "profile_invalid":
      return failure("invalid_input", "the common profile does not accept the skill plugin");
    default:
      return assertNever(error, "PluginPortFailure");
  }
}
