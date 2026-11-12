import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ssh 사전 점검 시험용 가짜 `ssh`, `ssh-keyscan`, `ssh-keygen`. 실제 자식 프로세스를 띄우는 셸 스크립트이고,
// 응답은 시나리오 디렉터리의 파일로 고른다(tunnel.int.test.ts의 fixtures 방식: 실행 파일을 끼워 실제 spawn을 시험한다).
//
// 응답 파일: `<종류>.out`, `<종류>.err`, `<종류>.code`. `<종류>.<n>.*`는 n번째 호출에만 쓰고, 없으면 `<종류>.*`를 쓴다.
// 종류: resolve(ssh -G), connect(ssh … true), version, status, ensure(ssh 원격 명령), keyscan, remove(ssh-keygen -R).
// 호출 기록은 `calls.log`에 `<도구> <인자…>` 줄로 쌓인다. 지문은 ssh-keygen -lf -가 받은 줄의 키 blob으로 만든다.

type FakeKind = "resolve" | "connect" | "version" | "status" | "ensure" | "keyscan" | "remove";

interface FakeReply {
  readonly out?: string;
  readonly err?: string;
  readonly code?: number;
}

export interface FakeSsh {
  /** 임시 디렉터리 전체. 시험이 끝나면 지운다 */
  readonly root: string;
  /** 가짜 홈. known_hosts는 `<home>/.ssh/known_hosts` */
  readonly home: string;
  readonly sshPath: string;
  readonly keyscanPath: string;
  readonly keygenPath: string;
  /** 응답을 쓴다. `n`을 주면 그 번째 호출만 바뀐다 */
  reply(kind: FakeKind, reply: FakeReply, n?: number): void;
  /** 가짜 도구들이 받은 호출 줄. 호출이 없으면 빈 목록 */
  calls(): string[];
}

function script(name: string, scenario: string, body: string): string {
  return `#!/bin/sh
SCN='${scenario}'
bump() {
  kind="$1"
  file="$SCN/count.$kind"
  n=0
  if [ -f "$file" ]; then n=$(cat "$file"); fi
  n=$((n + 1))
  echo "$n" > "$file"
  echo "$n"
}
reply() {
  kind="$1"
  n="$2"
  for ext in out err code; do
    f="$SCN/$kind.$n.$ext"
    if [ ! -f "$f" ]; then f="$SCN/$kind.$ext"; fi
    if [ -f "$f" ]; then
      if [ "$ext" = out ]; then cat "$f"; fi
      if [ "$ext" = err ]; then cat "$f" >&2; fi
      if [ "$ext" = code ]; then exit "$(cat "$f")"; fi
    fi
  done
  exit 0
}
echo "${name} $*" >> "$SCN/calls.log"
${body}
`;
}

const SSH_BODY = `case " $* " in
  *" -G "*) kind=resolve ;;
  *" fresnel version --json "*) kind=version ;;
  *" fresnel service status --json "*) kind=status ;;
  *" fresnel service ensure --json "*) kind=ensure ;;
  *) kind=connect ;;
esac
n=$(bump "$kind")
reply "$kind" "$n"`;

const KEYSCAN_BODY = `n=$(bump keyscan)
reply keyscan "$n"`;

const KEYGEN_BODY = `case " $* " in
  *" -R "*)
    n=$(bump remove)
    reply remove "$n"
    ;;
  *)
    read -r hostf keytype blob rest
    up=$(echo "$keytype" | tr 'a-z' 'A-Z' | sed 's/^SSH-//')
    echo "256 SHA256:$blob $hostf ($up)"
    ;;
esac`;

export function makeFakeSsh(): FakeSsh {
  const root = mkdtempSync(join(tmpdir(), "xssh-"));
  const scenario = join(root, "scenario");
  const home = join(root, "home");
  mkdirSync(scenario);
  mkdirSync(home);
  const sshPath = join(root, "ssh");
  const keyscanPath = join(root, "ssh-keyscan");
  const keygenPath = join(root, "ssh-keygen");
  const files: [string, string][] = [
    [sshPath, script("ssh", scenario, SSH_BODY)],
    [keyscanPath, script("ssh-keyscan", scenario, KEYSCAN_BODY)],
    [keygenPath, script("ssh-keygen", scenario, KEYGEN_BODY)],
  ];
  for (const [path, text] of files) {
    writeFileSync(path, text);
    chmodSync(path, 0o755);
  }
  // 기본 응답: 대상 기기는 `box.example`, 서비스는 돌고 있고 버전이 맞다
  const defaults: [string, string][] = [
    ["resolve.out", "hostname box.example\nport 22\nuser me\nproxyjump none\nproxycommand none\n"],
    ["version.out", '{"cli":"0.4.0","contract":"0.1.0","bun":"1.3.0"}\n'],
    [
      "status.out",
      '{"running":true,"registration":{"socket":"/run/user/1000/fresnel/fresnel.sock","version":"0.4.0"}}\n',
    ],
  ];
  for (const [name, text] of defaults) writeFileSync(join(scenario, name), text);

  return {
    root,
    home,
    sshPath,
    keyscanPath,
    keygenPath,
    reply(kind, reply, n) {
      const stem = n === undefined ? kind : `${kind}.${String(n)}`;
      if (reply.out !== undefined) writeFileSync(join(scenario, `${stem}.out`), reply.out);
      if (reply.err !== undefined) writeFileSync(join(scenario, `${stem}.err`), reply.err);
      if (reply.code !== undefined) {
        writeFileSync(join(scenario, `${stem}.code`), `${String(reply.code)}\n`);
      }
    },
    calls() {
      const log = join(scenario, "calls.log");
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "");
    },
  };
}
