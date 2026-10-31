import { t, type MessageId } from "@xeon/client/i18n";
import type { TrustChoice, TrustOption, TrustStatus } from "@xeon/contracts/wire";

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
  readonly primary: boolean;
};

export type TrustCardView = {
  readonly projectRoot: string;
  /** 결정이 없는 상태(undecided)인지, 이미 거부한 상태인지. 문구가 다르다 */
  readonly state: "undecided" | "denied";
  readonly resources: readonly string[];
  readonly buttons: readonly TrustButton[];
};

function buttonOf(option: TrustOption): TrustButton {
  return {
    choice: option.choice,
    text: labelTextOf(option.label),
    savedPath: option.savedPath,
    primary: option.choice.verdict === "allow",
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
    buttons: status.options.map(buttonOf),
  };
}
