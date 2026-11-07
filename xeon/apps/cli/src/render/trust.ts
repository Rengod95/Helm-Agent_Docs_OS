import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type {
  TrustChoice,
  TrustListEntry,
  TrustOption,
  TrustStatus,
  TrustVia,
} from "@fresnel/contracts/wire";
import type { PromptIo } from "./approval.ts";

// L4.cli.spec §4.11 "프로젝트 신뢰". 프로젝트 신뢰 카드: 폴더와 불러오려는 자원을 보이고, host가 만든 선택지에서 번호로 고른다.
// 엔터나 EOF는 "나중에"이고 아무것도 저장하지 않는다(그 프로젝트는 계속 신뢰하지 않은 채로 열린다).
// 선택지의 `label`은 현지화 식별자(F wire)라 글은 CLI가 `choice`로 만든다.

/** 선택지 한 줄의 글 */
export function optionText(option: TrustOption): string {
  const { kind, verdict } = option.choice;
  const where =
    option.savedPath === null ? "" : t("cli.render.trust.savedAt", { path: option.savedPath });
  switch (kind) {
    case "folder":
      return `${verdict === "allow" ? t("cli.render.trust.folderAllow") : t("cli.render.trust.folderDeny")}${where}`;
    case "parent":
      return `${verdict === "allow" ? t("cli.render.trust.parentAllow") : t("cli.render.trust.parentDeny")}${where}`;
    case "session":
      return verdict === "allow"
        ? t("cli.render.trust.sessionAllow")
        : t("cli.render.trust.sessionDeny");
    default:
      return assertNever(kind, "TrustChoiceKind");
  }
}

function viaText(via: TrustVia): string {
  switch (via) {
    case "override":
      return t("cli.render.trust.via.override");
    case "notRequired":
      return t("cli.render.trust.via.notRequired");
    case "point":
      return t("cli.render.trust.via.hook");
    case "store":
      return t("cli.render.trust.via.store");
    case "sessionMemory":
      return t("cli.render.trust.via.sessionMemory");
    case "default":
      return t("client.settings.scope.default");
    case "prompt":
      return t("cli.render.trust.via.prompt");
    case "headless":
      return t("cli.render.trust.via.headless");
    case "corruptStore":
      return t("cli.render.trust.via.corruptStore");
    default:
      return assertNever(via, "TrustVia");
  }
}

function verdictText(verdict: TrustStatus["verdict"]): string {
  switch (verdict) {
    case "allow":
      return t("cli.render.trust.verdict.allow");
    case "deny":
      return t("cli.render.trust.verdict.deny");
    case "undecided":
      return t("cli.render.trust.verdict.undecided");
    default:
      return assertNever(verdict, "TrustVerdict");
  }
}

/** 신뢰 상태와 선택지를 번호와 함께 보이는 글. `fresnel trust`와 시작 카드가 같이 쓴다 */
export function describeTrust(status: TrustStatus): string {
  const lines = [t("cli.render.trust.project", { root: status.projectRoot })];
  if (status.resources.length > 0) {
    lines.push(t("cli.render.trust.resources", { resources: status.resources.join(", ") }));
  }
  lines.push(
    t("cli.render.trust.verdictLine", {
      verdict: verdictText(status.verdict),
      via: viaText(status.via),
    }),
  );
  if (status.required) {
    lines.push(t("cli.render.trust.required"));
  }
  status.options.forEach((option, index) => {
    lines.push(`  ${String(index + 1)}) ${optionText(option)}`);
  });
  return `${lines.join("\n")}\n`;
}

/** 저장된 결정 목록의 글. 한 줄에 폴더 하나이고 `허용 <폴더>` 또는 `거부 <폴더>`다(`fresnel trust list`, 읽기 전용) */
export function describeTrustList(entries: readonly TrustListEntry[]): string {
  return entries.map((entry) => `${listVerdictText(entry.verdict)} ${entry.path}\n`).join("");
}

function listVerdictText(verdict: TrustListEntry["verdict"]): string {
  switch (verdict) {
    case "allow":
      return t("cli.render.trust.listAllow");
    case "deny":
      return t("cli.render.trust.listDeny");
    default:
      return assertNever(verdict, "TrustListVerdict");
  }
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
    const line = await io.readLine(t("cli.render.trust.prompt"), signal);
    const text = line?.trim() ?? "";
    if (text.length === 0) return undefined;
    const picked = /^\d+$/.test(text) ? status.options[Number(text) - 1] : undefined;
    if (picked !== undefined) return picked.choice;
    // oxlint-disable-next-line no-await-in-loop -- 잘못된 입력을 알린 뒤 다시 묻는다 (L4.cli.spec §4.11)
    await io.stdout(t("cli.render.trust.invalid"));
  }
}
