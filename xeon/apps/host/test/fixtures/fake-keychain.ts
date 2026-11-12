import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 가짜 OS 키 저장소(키체인 자리). macOS `security` 명령 대신 쓰는 셸 스크립트(0700)다. 항목 하나를 임시 파일(0600)에 둔다.
// 운영 코드(platform-secrets의 darwin 제공자)는 이 스크립트를 `security`의 절대 경로로 받아 그대로 돈다. sops도 SOPS_AGE_KEY_CMD로
// 이 스크립트를 실행해 identity를 받는다. 실제 키체인과 실제 `security`는 시험이 건드리지 않는다.
// 스크립트가 맞는 모양은 darwin 제공자의 argv와 stdin 줄 모양(find-generic-password, `security -i`의 add-generic-password, delete-generic-password)뿐이다.

export interface FakeKeychain {
  /** 호스트의 `os.resolveBinary("security")` 자리에 넣는 절대 경로 */
  readonly securityPath: string;
  /** 항목이 지금 있는가(시험이 확인할 때만 쓴다) */
  holds(): boolean;
  dispose(): void;
}

export function fakeKeychain(): FakeKeychain {
  const dir = mkdtempSync(join(tmpdir(), "xkc-"));
  const item = join(dir, "item.txt");
  const securityPath = join(dir, "security");
  const script = [
    "#!/bin/sh",
    "# 가짜 security(시험 전용). 실제 키체인이 아니다.",
    `ITEM='${item}'`,
    'case "$1" in',
    "  find-generic-password)",
    '    [ -f "$ITEM" ] || exit 44',
    '    case " $* " in *" -w "*) cat "$ITEM"; printf \'\\n\' ;; esac',
    "    exit 0 ;;",
    "  -i)",
    `    id=$(sed -n 's/.* -w \\(AGE-SECRET-KEY-1[A-Z0-9]*\\)$/\\1/p')`,
    '    [ -n "$id" ] || exit 1',
    "    umask 077",
    `    printf '%s' "$id" > "$ITEM"`,
    "    exit 0 ;;",
    "  delete-generic-password)",
    '    [ -f "$ITEM" ] || exit 44',
    '    rm -f "$ITEM"',
    "    exit 0 ;;",
    "esac",
    "exit 2",
    "",
  ].join("\n");
  writeFileSync(securityPath, script, { mode: 0o700 });
  chmodSync(securityPath, 0o700);
  return {
    securityPath,
    holds: () => existsSync(item),
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
