import { EXIT, type ExitCode } from "../exit-codes.ts";

// L4.cli.spec §3.1 명령 표. 도움말에 보이지 않는 명령(host --stdio, service launch-mode, service run)은 싣지 않는다.

const OVERVIEW = `xeon: 대화형 에이전트 런타임

사용법: xeon [공통 플래그] [명령] [인자]

명령
  chat                      대화형 모드 (기본). 터미널이 아니면 print 모드로 바뀐다
  chat -p <입력>            print 모드: 입력 하나로 turn 하나를 돌리고 응답을 stdout에 쓴다
                            -p - 또는 -p만 쓰면 stdin 전체가 입력이다
  chat -p <입력> --json     JSON 모드: 연결에서 오간 JSON-RPC 메시지를 한 줄에 하나씩 쓴다
  chat --continue           현재 작업 폴더의 마지막 세션을 이어 연다
  chat --resume <id>        지정한 세션을 이어 연다
  chat --set <키>=<값>      이 세션에만 설정을 덮어쓴다 (여러 번 쓸 수 있다)
  sessions ls [--all] [--limit n] [--json]
  sessions show <id> [--json]
  sessions fork <id> [--at <항목 id>]
  sessions rm <id> [--yes]  세션 목록, 보기, 분기, 삭제
  sessions rename <id> <제목>  세션 제목을 바꾼다 (200자 이하)
  config get [<키>…]        유효 값과 출처를 보인다
  config schema --scope <managed|user|project|local> [--out <경로>] [--core-only]
                            설정 파일 JSON Schema를 쓴다
  config set <키> <값> [--scope user|project|local]
  config reset <키> [--scope user|project|local]
  config list [--prefix <p>] [--deprecated] [--json]
                            설정 쓰기, 지우기, 목록
  secret ls|add|set|meta|rotate|rm|test|reveal
                            비밀 관리. 값은 프롬프트나 stdin으로만 받는다. reveal은 터미널에서만 쓴다
  trust [status] [--json]   이 작업 폴더의 프로젝트 신뢰 상태와 선택지를 보인다
  trust allow|deny [--scope folder|parent|session]
                            신뢰 결정을 보낸다. 신뢰하면 .mcp.json, 프로젝트 스킬, 프로젝트 명령을 읽는다
  service start|status|stop|ensure [--json] [--safe-mode] [--listen-tcp <호스트>:<포트>]
                            공유 서비스 모드. start·ensure는 서비스를 띄우고(이미 떠 있으면 붙는다),
                            status·stop은 조회·정지한다. 안전 모드와 TCP는 새로 띄울 때만 적용된다
  doctor [--json]           진단: 엔진, 저장소, 비밀 저장소, 터미널, 검색 provider
  version [--json]          버전

공통 플래그
  -h, --help                도움말
  --no-color                색 끄기 (NO_COLOR 환경 변수도 같다)
  -C <폴더>                 작업 폴더

종료 코드
  0 정상   1 일반 오류   2 사용법 오류   3 환경 문제   4 세션 잠금
  129 SIGHUP   130 중단(Ctrl+C)   143 SIGTERM
`;

const TOPICS: Readonly<Record<string, string>> = {
  chat: `사용법: xeon chat [-p [<입력>]] [--json] [--continue | --resume <id>] [--set <키>=<값>]…

  -p, --print [<입력>]   print 모드. 입력이 없거나 -이면 stdin 전체를 입력으로 쓴다
  --json                 print 모드에서 JSON-RPC 메시지를 한 줄에 하나씩 쓴다
  --continue             현재 작업 폴더의 마지막 세션을 이어 연다
  --resume <id>          지정한 세션을 이어 연다
  --set <키>=<값>        이 세션에만 설정을 덮어쓴다 (여러 번 쓸 수 있다)
`,
  config: `사용법: xeon config get [<키>…] [--json]
       xeon config schema --scope <managed|user|project|local> [--out <경로>] [--core-only]
       xeon config set <키> <값> [--scope user|project|local]
       xeon config reset <키> [--scope user|project|local]
       xeon config list [--prefix <p>] [--deprecated] [--json]
`,
};

/** 도움말을 stdout에 쓴다. 모르는 주제는 전체 도움말이다 */
export async function runHelp(
  topic: string | null,
  stdout: (text: string) => Promise<void>,
): Promise<ExitCode> {
  const text = topic === null ? undefined : TOPICS[topic];
  await stdout(text ?? OVERVIEW);
  return EXIT.ok;
}
