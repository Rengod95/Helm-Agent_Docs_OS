// 마이그레이션 라이브러리의 공용 타입. review.m5-migration §4.1, §5.2, §7.2의 모양을 첫 조각(조각 1)의 범위로 줄인 것이다.
// 이 파일은 타입만 갖는다. wire(`migration.*`)로 옮길 때는 같은 모양을 TypeBox 스키마로 옮긴다(enC1의 계약이 병합된 뒤).

/** 원본 하네스. 첫 조각은 셋이다: Claude Code 형식, 공통 AGENTS.md, 공통 Agent Skills */
export type HarnessId = "claude-code" | "agents-md" | "agent-skills";

/** 중간 표현의 종류(§4.1). instruction, skill, command, agent, mcp, field, blocked는 조각 1이고 hook은 조각 2다 */
export type IrKind =
  | "instruction"
  | "skill"
  | "command"
  | "agent"
  | "mcp"
  | "field"
  | "blocked"
  | "hook";

export type ItemScope = "user" | "project" | "local" | "managed" | "plugin";

// ── 읽기 전용 파일 접근 ────────────────────────────────────────────────────

export type ScanStat = {
  readonly kind: "file" | "dir" | "symlink" | "other";
  readonly size: number;
};

export type ScanRead =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly bytes: Uint8Array }
  | { readonly kind: "too_large" }
  | { readonly kind: "unreadable" };

/** 읽기 전용이다. 쓰기, 삭제, 이름 바꾸기 메서드가 없다(수용 기준 4) */
export interface ScanFs {
  /** 없으면 null. 심볼릭 링크는 따라가지 않고 `symlink`로 돌려준다 */
  lstat(path: string): Promise<ScanStat | null>;
  /** 항목 이름만 돌려준다(경로 아님). 정렬은 호출자가 한다 */
  listDir(path: string): Promise<readonly string[]>;
  readBounded(path: string, maxBytes: number): Promise<ScanRead>;
  realpath(path: string): Promise<string>;
}

export interface ScanRoot {
  /** 절대 경로. 홈은 `~`로 줄여 쓰지 않는다(어댑터가 항목 경로를 쓸 때 `homeDir`로 줄인다) */
  readonly path: string;
  readonly scope: "user" | "project";
  readonly label: string;
}

export interface ScanLimits {
  /** 파일 하나의 상한(바이트). 기본 1 MiB */
  readonly maxFileBytes: number;
  /** 스킬 폴더 하나의 파일 수 상한. 기본 2000 */
  readonly maxSkillFiles: number;
  /** 스킬 폴더 하나의 합계 바이트 상한. 기본 32 MiB */
  readonly maxSkillBytes: number;
  /** 폴더 깊이 상한. 기본 16 */
  readonly maxDepth: number;
  /** `~/.claude.json` 읽기 상한. 기본 16 MiB */
  readonly maxClaudeJsonBytes: number;
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  maxFileBytes: 1024 * 1024,
  maxSkillFiles: 2000,
  maxSkillBytes: 32 * 1024 * 1024,
  maxDepth: 16,
  maxClaudeJsonBytes: 16 * 1024 * 1024,
};

export interface ScanContext {
  /** 사용자 홈의 절대 경로. 항목 경로를 `~/…`로 줄이는 데만 쓴다 */
  readonly homeDir: string;
  /**
   * PATH에서 실행 파일 이름을 찾는다(없으면 undefined). 환경 모드 훅의 도구 존재 검사에만 쓴다. 없으면 그 검사를 하지 않는다.
   * 실행하지 않는다. 호출자(훑기 자식)가 PATH를 어떻게 볼지 정한다.
   */
  readonly onPath?: (name: string) => string | undefined;
}

// ── 중간 표현(IR) ─────────────────────────────────────────────────────────

export interface IrFile {
  /** 스킬 폴더 기준 상대 경로(`/` 구분) */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface IrInstruction {
  readonly kind: "instruction";
  /** 파일 이름에서 확장자를 뺀 값. 초안의 `instructions/<name>.md`가 된다 */
  readonly name: string;
  /** 가져오기(`@경로`)를 푼 뒤의 원문. 머리글이나 설명을 더하지 않는다 */
  readonly text: string;
  /** 첫 조각은 `always`만 옮긴다. `globs`가 있는 규칙은 `activation: "globs"`로 잡혀 보고만 된다 */
  readonly activation: "always" | "globs";
  readonly globs: readonly string[];
  /** 지침의 출처 종류. `project_file`은 프로젝트의 CLAUDE.md 계열이라 옮기지 않는다(§6.2) */
  readonly role: "user_global" | "rule" | "project_file" | "agents_md";
  /** `role: "project_file"`일 때만. 본문이 `@AGENTS.md` 한 줄뿐이다 */
  readonly onlyAgentsMdImport: boolean;
  /** 가져오기를 푼 순서대로의 조각. 연결하면 `text`와 같다. 가져온 파일 경로(루트 기준)가 `source`다 */
  readonly parts: readonly { readonly source: string; readonly text: string }[];
}

export interface IrSkill {
  readonly kind: "skill";
  /** 폴더 이름 */
  readonly dirName: string;
  /** 머리말 `name`. 없으면 undefined */
  readonly name: string | undefined;
  readonly description: string | undefined;
  /** 폴더 안의 모든 파일(SKILL.md 포함), 경로 순 */
  readonly files: readonly IrFile[];
}

export interface IrCommand {
  readonly kind: "command";
  /** 이름 공간(`a/b.md` → `a-b`)을 평탄화한 이름 */
  readonly name: string;
  /** 원래 상대 경로(`.claude/commands/` 기준, `a/b.md`) */
  readonly relPath: string;
  /** 파일 전체 원문(머리말 포함) */
  readonly text: string;
  readonly description: string | undefined;
  /** 본문에 `$ARGUMENTS`, `$1`, `$이름`, `` !`cmd` `` 같은 치환이 있다 */
  readonly hasSubstitutions: boolean;
}

export interface IrAgent {
  readonly kind: "agent";
  /** 파일 이름에서 확장자를 뺀 값 */
  readonly fileName: string;
  readonly name: string | undefined;
  readonly description: string | undefined;
  /** 머리말 뒤의 본문 */
  readonly prompt: string;
  /** Claude `tools`를 쉼표로 나눈 이름들. 없으면 undefined */
  readonly tools: readonly string[] | undefined;
  readonly disallowedTools: readonly string[] | undefined;
  readonly model: string | undefined;
  readonly permissionMode: string | undefined;
}

export interface IrMcp {
  readonly kind: "mcp";
  /** 원본 서버 이름 */
  readonly serverName: string;
  /** 정규화한 서버 id. 정규화가 불가능하면 undefined */
  readonly id: string | undefined;
  readonly transport: "stdio" | "http" | "sse" | "ws" | "unknown";
  /** 가린 뒤의 정의(시크릿 값은 `secret://` 참조나 빠짐). 변환 불가면 undefined */
  readonly def: McpDefDraft | undefined;
  /** 시크릿 참조로 바뀐 자리(환경 변수 참조 또는 리터럴 시크릿). 값은 없다. `def`의 해당 값은 `secret://<secretName>`이다 */
  readonly secretRefs: readonly {
    /** `env.API_KEY`, `headers.Authorization` 같은 자리 */
    readonly place: string;
    /** 원본 환경 변수 이름, 리터럴이면 env·header 이름 */
    readonly varName: string;
    /** `secret://` 뒤의 이름. `^[a-z][a-z0-9-]{1,63}$` */
    readonly secretName: string;
    readonly origin: "env_ref" | "literal";
  }[];
  /** 프로젝트 범위 서버가 프로젝트 경로를 참조(`${CLAUDE_PROJECT_DIR}`, 상대 cwd)했다 */
  readonly projectBound: boolean;
}

/** `McpServerDef`와 같은 모양의 초안. 검증은 `McpServerDefSchema`와 `checkDefinitionValues`와 같은 규칙으로 한다 */
export interface McpDefDraft {
  readonly transport:
    | {
        readonly type: "stdio";
        readonly command: string;
        readonly args?: readonly string[];
        readonly cwd?: string;
        readonly env?: Readonly<Record<string, string>>;
      }
    | {
        readonly type: "http" | "sse";
        readonly url: string;
        readonly headers?: Readonly<Record<string, string>>;
        readonly oauth?: boolean;
      };
  readonly timeouts?: { readonly connectMs?: number; readonly callMs?: number };
}

/** 알려진 컨테이너(스킬 머리말, 서브에이전트 머리말, 명령 머리말, MCP 항목)의 키 하나. 규칙이 처리를 정한다 */
export interface IrField {
  readonly kind: "field";
  /** 키를 가진 컨테이너: `skill`, `command`, `agent`, `mcp`, `skill-body` */
  readonly container: string;
  readonly key: string;
  /** 사람이 읽는 값 요약(시크릿이 아닐 때만. 가린 뒤). 없으면 undefined */
  readonly summary: string | undefined;
}

/** 어댑터가 알아본, 옮길 수 없다고 이미 정해진 것(범위 밖 가져오기, 알 수 없는 위치의 파일 등) */
export interface IrBlocked {
  readonly kind: "blocked";
  readonly of: IrKind;
  /** 규칙 데이터가 `match.code`로 고르는 값 */
  readonly code: string;
  readonly text: string;
}

/** 플러그인 스크립트의 실행기(매니페스트 `ScriptRunnerSchema`와 같은 고정 목록) */
export type HookRunner = "sh" | "bash" | "bun" | "node" | "python3";

/**
 * 환경 모드(가져온 `command` 훅, AGE-58 사용자 결정 2026-11-20: 스크립트는 복사하지 않고 제자리에서 원래 환경으로 돈다)의 재료.
 * 명령 원문을 그대로 싣는다: 명령에 리터럴 시크릿이 있으면 이 값이 만들어지기 전에 `secret_in_command`로 거른다.
 * 파일 바이트는 싣지 않는다(참조 파일은 지문만 내고, 입력 필드 이름만 본다).
 */
export interface IrHookEnv {
  /** 원래 명령 문자열 원문 */
  readonly command: string;
  /** 명령을 돌리는 셸. 원래 훅 객체의 `shell`이 `bash`면 `bash`, 아니면 `sh`다 */
  readonly shell: "sh" | "bash";
  /** 명령이 읽을 파일(절대 경로)과 지문(`sha256:<hex>`, 읽지 못했으면 null). 최대 16개 */
  readonly refs: readonly { readonly path: string; readonly hash: string | null }[];
  /** 참조 파일을 하나라도 찾았는가. 거짓이면 어떤 파일을 읽는지 알 수 없다(추측하지 않는다) */
  readonly refsKnown: boolean;
  /** 찾은 참조 파일의 본문이 읽는 입력 필드 이름들(`transcript_path` 등, 정해진 목록에서만 고른다). 본문은 싣지 않는다 */
  readonly readsInputs: readonly string[];
  /** 셸 내장과 환경 변수 접두를 건너뛴 첫 실행 단어. 없으면 undefined */
  readonly firstWord?: string;
  /** PATH에서 찾지 못한 실행 파일 이름들(`ScanContext.onPath`가 있을 때만 채운다) */
  readonly missingTools: readonly string[];
  /** 버전의 근거가 되는 글(`python3.11` 이름, shebang 줄, 옆의 버전 파일 값). 버전을 실행으로 알아내지 않는다 */
  readonly versionHints: readonly string[];
  /** 찾기 과정에서 적을 말(상한을 넘은 참조, 지문을 못 낸 파일, 변수로 정해진 파일 등) */
  readonly notes: readonly string[];
}

/**
 * 설정 `hooks`의 핸들러 하나(`settings.hooks.<이벤트>[i].hooks[j]`). `code`가 있으면 옮기지 못하는 이유 코드이고,
 * 규칙표가 `not_ported`의 이유 문장을 고른다. `command` 핸들러를 옮기면 `env`가 있다.
 */
export interface IrHook {
  readonly kind: "hook";
  /** 원본 이벤트 이름(`PreToolUse` 등). 알 수 없는 이벤트도 그대로 싣는다 */
  readonly event: string;
  /** 매처 원문. 없거나 빈 값이면 undefined */
  readonly matcher: string | undefined;
  /** 핸들러 종류 원문(`command`, `http`, `prompt`, `agent`, `mcp_tool`, 그 밖) */
  readonly handler: string;
  /** 시간 제한(초) 원문. 없으면 undefined(원본 기본 600초) */
  readonly timeoutSeconds: number | undefined;
  /** 옮기지 못하는 키 이름들(`if`, `async` 등). 값은 싣지 않는다 */
  readonly extraKeys: readonly string[];
  /** 옮기지 못하는 이유 코드. 없으면 규칙표가 이벤트와 핸들러로 정한다 */
  readonly code: string | undefined;
  /** `command` 핸들러를 옮길 때만 있다(환경 모드) */
  readonly env: IrHookEnv | undefined;
}

export type IrNode =
  | IrInstruction
  | IrSkill
  | IrCommand
  | IrAgent
  | IrMcp
  | IrField
  | IrBlocked
  | IrHook;

// ── 훑기 결과 ─────────────────────────────────────────────────────────────

export type ItemSecret = {
  readonly keyPath: string;
  readonly kind: "env_ref" | "literal";
  readonly name?: string;
};

export interface SourceItem {
  /** hash(harness, kind, scope, keyPath 또는 path)의 앞 16자리 16진수. 내용이 바뀌어도 같다 */
  readonly itemId: string;
  readonly harness: HarnessId;
  readonly kind: IrKind;
  readonly scope: ItemScope;
  /** 이 항목을 훑은 `ScanRoot.label`. 프로젝트 이름 프로필 제안에 쓴다 */
  readonly rootLabel: string;
  /** 홈은 `~`로 줄인 경로 */
  readonly path: string;
  readonly keyPath?: string;
  readonly sha256: string;
  readonly bytes: number;
  /** 가린 뒤의 중간 표현. 시크릿 값은 없다 */
  readonly ir: IrNode;
  /** 값 없이 자리와 이름만 */
  readonly secrets: readonly ItemSecret[];
  readonly warnings: readonly string[];
}

export interface ScanDiagnostic {
  readonly code: "unreadable" | "too_large" | "invalid_json" | "limit" | "invalid_frontmatter";
  readonly path: string;
  readonly message: string;
}

export interface MigrationScan {
  readonly roots: readonly ScanRoot[];
  /** 훑은 위치(보고서 머리에 밝힌다). 홈은 `~`로 줄인다 */
  readonly scanned: readonly string[];
  readonly items: readonly SourceItem[];
  readonly diagnostics: readonly ScanDiagnostic[];
  readonly limits: ScanLimits;
}

export interface SourceAdapter {
  readonly harness: HarnessId;
  readonly rulesVersion: string;
  scan(
    root: ScanRoot,
    fs: ScanFs,
    limits: ScanLimits,
    ctx: ScanContext,
  ): Promise<{
    readonly items: readonly SourceItem[];
    readonly diagnostics: readonly ScanDiagnostic[];
    readonly scanned: readonly string[];
  }>;
}

// ── 규칙, 제안, 보고서 ────────────────────────────────────────────────────

export type ReportStatus = "exact" | "differs" | "not_ported" | "not_needed";

export type DifferenceKind =
  | "semantic_loss"
  | "scope_change"
  | "time_limit"
  | "cost"
  | "enforcement_change"
  | "approval_flow"
  | "renamed"
  | "user_choice";

/**
 * 보고 줄의 알림. 차이(`differences`)와 이유(`reason`)에 들지 않는 사실을 코드와 글로 싣는다.
 * `env_mode`는 원래 명령을 그대로 싣고 원래 환경에서 돈다는 알림이고, `tool_missing`은 이 기기에 없는 실행 파일이다.
 */
export type ReportNoteCode =
  | "env_mode"
  | "refs_unknown"
  | "tool_missing"
  | "version_hint"
  | "env_note";

export interface ReportNote {
  readonly code: ReportNoteCode;
  readonly text: string;
}

export interface ReportLine {
  readonly itemId: string;
  readonly harness: HarnessId;
  readonly kind: IrKind;
  /** 사람이 읽는 이름: "스킬 deploy", "MCP 서버 github" */
  readonly label: string;
  readonly source: { readonly scope: ItemScope; readonly path: string; readonly key?: string };
  readonly status: ReportStatus;
  readonly differences: readonly { readonly kind: DifferenceKind; readonly text: string }[];
  readonly reason?: { readonly code: string; readonly text: string };
  readonly alternative?: string;
  /** 어느 플러그인 초안의 어느 파일로 갔나 */
  readonly output?: { readonly plugin: string; readonly path: string };
  /** 알림(환경 모드, 없는 도구, 버전 근거 등). 없으면 빈 목록이 아니라 키가 없다 */
  readonly notes?: readonly ReportNote[];
}

export interface Question {
  readonly id: string;
  readonly itemId: string;
  readonly text: string;
  /** 고를 수 있는 값. 첫째가 기본 제안이다 */
  readonly options: readonly string[];
}

/** 사용자의 답. 키는 `Question.id` */
export interface Choices {
  readonly answers: Readonly<Record<string, string>>;
  /** 플러그인 이름에 붙일 이름 충돌 회피용 이미 있는 플러그인 이름 */
  readonly existingPlugins?: readonly string[];
}

export interface UserConfigDraft {
  /** `ext.<플러그인>.<키>` 형식의 설정 키는 enC1의 매니페스트 계약이 정한다. 여기서는 키 이름과 안내만 */
  readonly key: string;
  readonly title: string;
  readonly sensitive: boolean;
  readonly required: boolean;
  /** 값이 들어갈 `secret://` 참조 이름(`secret://` 뒤) */
  readonly secretName: string;
}

/**
 * 환경 모드 선언(매니페스트 `scripts[].env`와 같은 모양). `runner`는 `shell`과 같고, `file`은 명령 원문을 담은 동반 파일이다.
 * 명령 원문은 매니페스트에 든다(AGE-58 사용자 결정, 2026-11-20). 시크릿 값이 없음은 호출자가 확인했다.
 */
export interface PluginScriptEnvDecl {
  readonly command: string;
  readonly shell: "sh" | "bash";
  readonly refs: readonly { readonly path: string; readonly hash: string | null }[];
  readonly refsKnown: boolean;
}

/** Hook 플러그인의 실행 선언. `emit`이 매니페스트 `entry`, `scripts`, `plugins[0]`에 옮긴다 */
export interface PluginRuntimeDecl {
  /** 확장 루트 기준 진입 파일(`./plugin.js`) */
  readonly entry: string;
  /** `g.runScript(name)`으로 부를 스크립트 선언들 */
  readonly scripts: readonly {
    readonly name: string;
    /** 환경 모드의 셸과 같다(`env.shell`) */
    readonly runner: PluginScriptEnvDecl["shell"];
    /** 플러그인 폴더 기준 상대 경로(`scripts/<이름>.cmd`, 명령 원문을 담은 동반 파일) */
    readonly file: string;
    readonly timeoutMs: number;
    readonly env: PluginScriptEnvDecl;
  }[];
  /** `g.on`으로 거는 지점 이름(정렬된 목록) */
  readonly hooks: readonly string[];
  /** 지점마다 낼 수 있는 결정 상한(위치가 허용하는 값) */
  readonly hookDecides: readonly { readonly hook: string; readonly decides: readonly string[] }[];
}

export interface PlannedPlugin {
  readonly name: string;
  /** 한 문장. 없으면 검토에서 승인할 수 없다(M5c §4.7.6) */
  readonly purpose: string;
  /** 카드 안쪽 면의 글. 없으면 검토에서 승인할 수 없다(`pluginReview.descriptionRequired`) [결정: 2026-11-23 사용자, AGE-31] */
  readonly description: string;
  /** 이 플러그인이 나온 원본 항목들 */
  readonly derivedFrom: readonly string[];
  /** 폴더 트리. 경로는 플러그인 폴더 기준 상대 경로(`/` 구분)이고 값은 바이트다 */
  readonly tree: ReadonlyMap<string, Uint8Array>;
  /** 결정적으로 못 만들어 빌더에게 넘길 itemId. 첫 조각은 항상 빈 목록이다 */
  readonly pendingBuilder: readonly string[];
  readonly userConfig: readonly UserConfigDraft[];
  /** Hook 플러그인이면 있다. 없으면 매니페스트에 실행 선언이 없다 */
  readonly runtime?: PluginRuntimeDecl;
  /**
   * Hook 플러그인이 어느 설정 파일에서 왔는지(enFp [제안]). 엔진이 훑기가 읽은 자리의 범위로 정한다. 매니페스트에는 싣지 않는다:
   * 호스트가 이 값을 검토 항목에 기록하고, 카드의 훅 출처(`origin`)는 그 기록에서만 나온다. Hook 플러그인이 아니거나 범위를 모르면 없다
   */
  readonly hookOrigin?: PlannedHookOrigin;
}

/** 가져온 훅의 출처. `label`은 프로젝트 범위일 때 그 프로젝트 폴더의 표시(홈은 `~`)이고 사용자 범위는 null이다 */
export interface PlannedHookOrigin {
  readonly kind: "user" | "project";
  readonly label: string | null;
}

export interface ProfileProposal {
  readonly profileName: string;
  /** 이 프로필에 넣자고 제안하는 플러그인 이름. 프로젝트 범위 항목만 모은다 */
  readonly plugins: readonly string[];
  readonly reason: string;
}

export interface MigrationProposal {
  readonly rulesVersions: Readonly<Record<string, string>>;
  readonly scanned: readonly string[];
  readonly plugins: readonly PlannedPlugin[];
  readonly profileProposals: readonly ProfileProposal[];
  readonly questions: readonly Question[];
  /** 항목 하나에 한 줄. 질문이 열려 있으면 해당 줄은 "예상"이다 */
  readonly report: readonly ReportLine[];
}

// ── 감지(M5g-0) ───────────────────────────────────────────────────────────

/** 감지 표지 하나. 존재만 확인한 결과이고 내용은 읽지 않는다 */
export interface ForeignFormatMarker {
  /** 프로젝트 루트 기준 상대 경로. 상위 폴더의 `.agents/skills`는 `../.agents/skills`처럼 적는다 */
  readonly marker: string;
  readonly harness: HarnessId | "other";
  /** 엔진이 이 자리를 읽는가. M5g-2 뒤에는 모든 표지가 거짓이다. 엔진은 다른 하네스 형식을 읽지 않고 가져오기로만 옮긴다 */
  readonly engineReads: boolean;
  /** 엔진이 예전에 읽던 자리이고 M5g-2에서 읽지 않게 된 자리인가(`.mcp.json`, `.agents/skills`). 알림의 `willStopReading`이 이 값으로 고른다 */
  readonly stoppedReading: boolean;
  /** 이 라이브러리의 첫 조각이 가져올 수 있는가 */
  readonly importable: boolean;
}
