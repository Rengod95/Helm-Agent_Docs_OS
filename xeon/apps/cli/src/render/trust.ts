import { assertNever } from "@xeon/contracts";
import type { TrustChoice, TrustOption, TrustStatus, TrustVia } from "@xeon/contracts/wire";
import type { PromptIo } from "./approval.ts";

// L4.cli.spec §4.11 "프로젝트 신뢰". 프로젝트 신뢰 카드: 폴더와 불러오려는 자원을 보이고, host가 만든 선택지에서 번호로 고른다.
// 엔터나 EOF는 "나중에"이고 아무것도 저장하지 않는다(그 프로젝트는 계속 신뢰하지 않은 채로 열린다).
// 선택지의 `label`은 현지화 식별자(F wire)라 글은 CLI가 `choice`로 만든다.

/** 선택지 한 줄의 글 */
export function optionText(option: TrustOption): string {
  const { kind, verdict } = option.choice;
  const where = option.savedPath === null ? "" : ` (저장: ${option.savedPath})`;
  switch (kind) {
    case "folder":
      return `${verdict === "allow" ? "이 폴더를 신뢰한다" : "이 폴더를 신뢰하지 않는다"}${where}`;
    case "parent":
      return `${verdict === "allow" ? "상위 폴더 전체를 신뢰한다" : "상위 폴더 전체를 신뢰하지 않는다"}${where}`;
    case "session":
      return verdict === "allow"
        ? "이번 실행에서만 신뢰한다 (저장하지 않는다)"
        : "이번 실행에서만 신뢰하지 않는다 (저장하지 않는다)";
    default:
      return assertNever(kind, "TrustChoiceKind");
  }
}

function viaText(via: TrustVia): string {
  switch (via) {
    case "override":
      return "설정이 정했다";
    case "notRequired":
      return "신뢰가 필요한 자원이 없다";
    case "point":
      return "확장이 정했다";
    case "store":
      return "저장된 결정";
    case "sessionMemory":
      return "이번 실행에서 정한 결정";
    case "default":
      return "기본값";
    case "prompt":
      return "방금 물어서 정했다";
    case "headless":
      return "묻는 화면이 없어 정하지 못했다";
    case "corruptStore":
      return "신뢰 저장 파일이 손상되어 읽지 못했다";
    default:
      return assertNever(via, "TrustVia");
  }
}

function verdictText(verdict: TrustStatus["verdict"]): string {
  switch (verdict) {
    case "allow":
      return "신뢰함";
    case "deny":
      return "신뢰하지 않음";
    case "undecided":
      return "아직 정하지 않음 (신뢰하지 않은 것으로 다룬다)";
    default:
      return assertNever(verdict, "TrustVerdict");
  }
}

/** 신뢰 상태와 선택지를 번호와 함께 보이는 글. `xeon trust`와 시작 카드가 같이 쓴다 */
export function describeTrust(status: TrustStatus): string {
  const lines = [`프로젝트: ${status.projectRoot}`];
  if (status.resources.length > 0) {
    lines.push(`불러오려는 자원: ${status.resources.join(", ")}`);
  }
  lines.push(`판정: ${verdictText(status.verdict)} - ${viaText(status.via)}`);
  if (status.required) {
    lines.push(
      "신뢰하면 이 자원의 지시문, 명령, MCP 서버가 사용자 권한으로 쓰인다. 신뢰하지 않으면 읽지 않는다",
    );
  }
  status.options.forEach((option, index) => {
    lines.push(`  ${String(index + 1)}) ${optionText(option)}`);
  });
  return `${lines.join("\n")}\n`;
}

/** 번호를 읽어 선택지를 고른다. 나중에(엔터, EOF, 중단)면 undefined다 */
export async function askTrust(
  status: TrustStatus,
  io: PromptIo,
  signal: AbortSignal,
): Promise<TrustChoice | undefined> {
  await io.stdout(describeTrust(status));
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- 알아듣는 입력이 올 때까지 같은 질문을 다시 묻는다 (L4.cli.spec §4.11)
    const line = await io.readLine("번호 (엔터는 나중에) > ", signal);
    const text = line?.trim() ?? "";
    if (text.length === 0) return undefined;
    const picked = /^\d+$/.test(text) ? status.options[Number(text) - 1] : undefined;
    if (picked !== undefined) return picked.choice;
    // oxlint-disable-next-line no-await-in-loop -- 잘못된 입력을 알린 뒤 다시 묻는다 (L4.cli.spec §4.11)
    await io.stdout("목록의 번호를 입력한다\n");
  }
}
