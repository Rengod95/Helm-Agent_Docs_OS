import { t, type MessageId } from "@fresnel/client/i18n";
import type { TrustChoice, TrustDetails, TrustOption, TrustStatus } from "@fresnel/contracts/wire";

// 프로젝트 신뢰 카드의 순수 로직(L4.desktop.spec §4.13). 판정(`trust.get`/`trust.decide`의 TrustStatus)을 카드가 그리는 값으로 바꾼다.
// 선택지의 `label`은 현지화 식별자다(F.wire-settings.spec). 이 표가 식별자를 카탈로그 id로 옮기고, 모르는 식별자는 식별자 그대로 보인다.

// 문구는 id로 들고 있다가 쓸 때 현재 로케일로 만든다
const LABEL_ID: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["trust-folder", "desktop.trust.option.trustFolder"],
  ["trust-parent", "desktop.trust.option.trustParent"],
  ["trust-session", "desktop.trust.option.trustSession"],
  ["deny-folder", "desktop.trust.option.denyFolder"],
  ["deny-session", "desktop.trust.option.denySession"],
]);

function labelTextOf(label: string): string {
  const id = LABEL_ID.get(label);
  return id === undefined ? label : t(id);
}

type TrustButton = {
  readonly choice: TrustChoice;
  readonly text: string;
  /** 저장되는 폴더(툴팁). `session` 선택지는 저장하지 않아 null이다 */
  readonly savedPath: string | null;
  /** 주 단추(솔리드)는 이 폴더 신뢰 하나다. 나머지는 고스트다(상위 폴더 전체 신뢰 포함) */
  readonly primary: boolean;
};

/** 자원 이름 묶음. 결정이 필요한 판정의 미리 보기를 화면 줄로 바꾼 것이다 */
export type TrustCardDetails = {
  /** `<이름>: <command> <args…>` 줄. 실행될 명령 그대로다 */
  readonly mcpServers: readonly string[];
  readonly hooks: readonly string[];
  readonly skills: readonly string[];
  readonly commands: readonly string[];
  readonly extensions: readonly string[];
};

export type TrustCardView = {
  readonly projectRoot: string;
  /** 결정이 없는 상태(undecided)인지, 이미 거부한 상태인지. 문구가 다르다 */
  readonly state: "undecided" | "denied";
  /** 파일 목록(프로젝트 루트 기준 상대 경로). 이름 묶음과 함께 보인다 */
  readonly resources: readonly string[];
  /** 이름 묶음. 미리 보기가 없으면(`details` 없음) null이고 카드는 파일 목록만 보인다 */
  readonly details: TrustCardDetails | null;
  readonly buttons: readonly TrustButton[];
};

/** MCP 서버 한 줄. `command`와 `args`는 실행될 그대로이고 환경 변수 값은 싣지 않는다 */
function mcpLineOf(server: TrustDetails["mcpServers"][number]): string {
  return [`${server.name}:`, server.command, ...server.args].join(" ");
}

function detailsOf(details: TrustDetails): TrustCardDetails {
  return {
    mcpServers: details.mcpServers.map((server) => mcpLineOf(server)),
    hooks: details.hooks,
    skills: details.skills,
    commands: details.commands,
    extensions: details.extensions,
  };
}

/** 상위 폴더 선택지는 저장될 폴더를 글자로 보인다(`상위 폴더 전체 신뢰: <경로>`). 나머지는 식별자 문구다 */
function textOf(option: TrustOption): string {
  if (option.choice.kind === "parent" && option.savedPath !== null) {
    return t("desktop.trust.option.trustParentAt", { path: option.savedPath });
  }
  return labelTextOf(option.label);
}

function buttonOf(option: TrustOption): TrustButton {
  return {
    choice: option.choice,
    text: textOf(option),
    savedPath: option.savedPath,
    primary: option.choice.kind === "folder" && option.choice.verdict === "allow",
  };
}

/**
 * 카드를 보일 판정이면 카드 값을, 아니면 null을 돌려준다. 신뢰가 필요 없거나(`required: false`) 이미 신뢰한 프로젝트는
 * 카드가 없다. 거부한 프로젝트는 바꿀 수 있게 카드를 남긴다.
 */
export function trustCardOf(status: TrustStatus): TrustCardView | null {
  if (!status.required || status.verdict === "allow") return null;
  return {
    projectRoot: status.projectRoot,
    state: status.verdict === "deny" ? "denied" : "undecided",
    resources: status.resources,
    details: status.details === undefined ? null : detailsOf(status.details),
    buttons: status.options.map(buttonOf),
  };
}

/**
 * 결정을 반영한 뒤 보일 토스트 문장. 허용으로 끝났을 때만 있다. 상위 폴더 선택이면 저장된 상위 폴더를, 아니면 작업 폴더를 적는다.
 * 이번 실행만 신뢰하면 저장하지 않으므로(선택지의 `savedPath`가 null) 작업 폴더를 적는다.
 */
export function trustedToastOf(status: TrustStatus, choice: TrustChoice): string | null {
  if (status.verdict !== "allow") return null;
  const option = status.options.find(
    (candidate) =>
      candidate.choice.kind === choice.kind && candidate.choice.verdict === choice.verdict,
  );
  const path = option?.savedPath ?? status.projectRoot;
  return choice.kind === "parent"
    ? t("desktop.trust.toast.parent", { path })
    : t("desktop.trust.toast.folder", { path });
}
