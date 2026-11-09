import { attemptAsync } from "@fresnel/contracts";

// 셸 기능 감지(L4.remote.spec §6.1). 웹 셸은 `shell_capabilities`에 답하고 Electron 셸은 이 명령이 없다(거절) → 데스크톱이다.
// 답은 `unknown`이라 `as` 없이 좁힌다. 모양이 틀리면 데스크톱으로 본다(기능을 더하지 않는 쪽이 안전하다).

/** 셸 종류. 웹이면 폴더 고르기 방식과 푸시 가능 여부를 가진다 */
export type ShellCapabilities =
  | { readonly kind: "desktop" }
  | { readonly kind: "web"; readonly folderPicker: "origin" | "none"; readonly push: boolean };

const DESKTOP: ShellCapabilities = { kind: "desktop" };

/** 객체의 자기 속성 하나. 객체가 아니거나 속성이 없으면 undefined다 */
function fieldOf(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor === undefined ? undefined : descriptor.value;
}

/** `shell_capabilities` 답을 읽는다. 거절됐거나 모양이 틀리면 데스크톱이다 */
export async function readShellCapabilities(
  invoke: (command: string) => Promise<unknown>,
): Promise<ShellCapabilities> {
  // Electron 셸은 이 명령을 두지 않아 거절한다. 거절은 오류가 아니라 "데스크톱"이라는 답이다
  const answered = await attemptAsync(() => invoke("shell_capabilities"));
  if (!answered.ok) return DESKTOP;
  const reply = answered.value;
  if (fieldOf(reply, "kind") !== "web") return DESKTOP;
  const picker = fieldOf(reply, "folderPicker");
  const push = fieldOf(reply, "push");
  return {
    kind: "web",
    folderPicker: picker === "origin" ? "origin" : "none",
    push: push === true,
  };
}
