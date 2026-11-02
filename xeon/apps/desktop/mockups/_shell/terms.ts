// UI 도메인 용어 한 곳(목업 전용). 용어가 아직 확정 전이라 화면에 보이는 도메인 말은 모두 여기서 가져온다.
// 이름을 바꿀 때는 이 파일만 고친다. 값은 _notes/terms-and-coverage.md §1.3 "제안 라벨"의 추천안(첫 칸)이다.
// 규칙: 페이지는 아래 단어를 문자열로 직접 쓰지 않는다. 문장 안에서는 템플릿 문자열로 끼운다(`${T.lead}를 넘겼어요`).
// 조사는 받침에 따라 바뀌므로, 문장에 끼우는 말은 josa()를 쓴다.
// 기계 id(훅 이름, 확장 id, 이벤트 kind)는 용어가 아니라 mono로 옆에 두는 값이라 여기 두지 않는다(DP-39).
// 묶음 E: 영어 값은 terms.en.ts(T_EN). 키를 더하면 거기에도 더한다(빠지면 타입 오류).
import { LANG } from "./i18n";
import { T_EN } from "./terms.en";

const T_KO = {
  // 층(F/X/L0~L4). 층 코드는 mono로 따로 쓴다.
  layer: "층",
  layerF: "계약",
  layerX: "확장 런타임",
  layerL0: "시스템",
  layerL1: "에이전트 코어",
  layerL2: "기능",
  layerL3: "오케스트레이션",
  layerL4: "앱",

  // 실행 흐름
  baseAgent: "기본 에이전트", // core-loop
  step: "단계", // step
  stepBoundary: "단계 사이", // step boundary(라벨). 문장: "이번 단계가 끝나면"
  turn: "턴",
  loopTrigger: "반복", // 예약 트리거 "루프"

  // 확장
  extension: "확장", // 플러그인 + 그룹
  plugin: "플러그인",
  group: "플러그인 그룹", // L3 플러그인 그룹
  extensionPoint: "훅", // point
  capability: "기능", // L2 capability
  block: "블록", // 그룹 안 조각(부품)
  blockSlot: "단계 자리", // group-sdk 슬롯
  groupKit: "그룹 SDK",
  manifest: "확장 정보 파일",
  handler: "핸들러", // 크래프트에서만. 대화 영역 문장은 extFailed
  extFailed: "확장이 실패했어요",
  autoDisabled: "자동 꺼짐",
  safeMode: "안전 모드",
  trust: "신뢰 수준",
  trustBuiltin: "내장",
  trustUser: "사용자 설치",
  trustProject: "이 프로젝트",
  trustUntrusted: "신뢰 안 함",
  promote: "기능으로 올리기", // 승격
  version: "버전",
  revert: "되돌리기",

  // 주도(drive lease)
  drive: "주도", // drive 연산 라벨. 상태 표시줄 "진행 Helm"
  lead: "주도", // drive lease
  leadQueue: "차례 기다림",
  leadLimit: "주도 한도",
  childAgent: "보조 에이전트", // spawn / 자식 에이전트
  lens: "렌즈", // Helm 제품 어휘
  inquiry: "탐구",
  finding: "발견",
  humanGate: "사람 확인", // drive 사람 확인 관문(loop.ask)

  // 연산 이름(크래프트에서만, mono 원어 병기)
  opOn: "보기",
  opPost: "입력 넣기",
  opDrive: "주도 맡기",
  opScope: "켜짐·꺼짐 바꾸기",

  // ADR-0021 화면 기여 slot
  slotPage: "전체 화면",
  slotWell: "옆 패널",
  slotCard: "대화 카드",
  slotStatus: "상태 표시줄",
  slotCommand: "명령",
  slotSettings: "설정",
  pluginView: "플러그인 UI",
  viewDeclarative: "기본 UI", // 선언형 모드
  viewFrame: "플러그인 앱", // 프레임 모드

  // 맥락·프로필·테스트
  context: "보기 기준", // 크래프트 맥락 칸
  contextAll: "전체",
  contextThread: "대화",
  contextProfile: "프로필",
  contextTrial: "테스트",
  pin: "고정",
  modelContext: "컨텍스트", // 모델 컨텍스트(맥락·문맥과 다름)
  compaction: "대화 요약",
  profile: "프로필",
  preview: "미리 보기", // profile.preview(W-44)
  applyToThread: "이 대화에 적용", // profile.apply(W-46, §6.28.3 동작)
  effectiveStack: "실효 스택", // §6.28.3: 맥락 대화 값과 프로필을 합친 결과
  flow: "흐름", // 구성기 보기(§6.28)
  trial: "테스트", // trial conversation
  trialThread: "테스트 대화",
  replay: "재실행 검사", // replayDrive(개발 모드)
  turnReplay: "트레이스", // 계측 trace 재생
  instrumentation: "계측",
  benchmark: "성능 측정",
  coreDiff: "보호 코드 변경 검사",
  devMode: "개발 모드",
  codeTest: "코드 테스트", // 코드 테스트(테스트와 구분)

  // 제작(authoring)
  authoring: "제작",
  authoringSession: "빌더 대화",

  // 셸·영역
  thread: "대화", // session/thread
  workbench: "크래프트",
  inbox: "받은 요청",
  proposals: "제안",
  schedules: "예약",
  connection: "연결",
  engine: "엔진",
  compose: "구성",
  overview: "개요",
  structure: "개요", // 층 × 단계 표 화면의 내비 이름(wb-v3 SPEC). overview와 어느 쪽을 남길지는 정본 결정 대기
  trials: "테스트",
  metrics: "성능 측정",
  localEngine: "이 컴퓨터(앱 안)", // 이 컴퓨터(앱 안)
  localService: "이 컴퓨터(백그라운드)",
  remoteEngine: "원격 컴퓨터",

  // 승인
  approval: "승인",
  approvalTool: "도구 실행",
  approvalPlan: "계획",
  approvalQuestion: "질문",
  approvalReview: "변경 검토",

  // 묶음 A(대화 영역 런타임, m4/pg-a). 병합 때 이 구역을 통째로 옮긴다.
  runtime: "런타임", // 대화 영역 런타임 줄·런타임 탭
  contextFollow: "따라감", // 보기 기준이 대화 영역의 열린 대화를 따라감(결정 11)
  unpin: "고정 풀기",
  authoringExt: "플러그인 빌더", // L3 그룹 authoring
  kind: "종류", // 카탈로그 종류(kind)
  catalog: "종류 목록", // 종류 카탈로그
  catalogBlocked: "준비 중", // 카탈로그 status blocked
  authoringCheck: "제작 검사", // AU-NNN
  writeScope: "쓰기 범위", // 대상 폴더 밖 쓰기 거부
  targetFolder: "대상 폴더",
  userExtDir: "사용자 확장 위치", // 설치 연결 대상
  stageIntent: "요구 정리", // 제작 단계 intent
  stageCompose: "구성 초안", // compose
  stageScaffold: "뼈대", // scaffold
  stageValidate: "검사", // validate
  stageFix: "고치기", // fix
  stagePackage: "묶기", // package
  stageDone: "끝",
  bundle: "묶음 파일", // authoring package 결과물
  installLink: "연결", // devkit.link: 사용자 확장 위치에 연결(설치). 문장: "사용자 확장 위치에 연결"
  viewMode: "화면 방식", // 선언형(viewDeclarative)·프레임(viewFrame) 중 에이전트가 고른 것(결정 1)
  leadReturn: "반납", // 사람 확인을 기다리며 주도를 놓음(X-17). 문장: "주도 반납"
  leadRetake: "다시 받음", // 답한 뒤 주도를 다시 쥠
  modeSteer: "바로", // 실행 중 입력 전달 방식 steer(지금 턴에 끼움)
  modeFollowUp: "끝난 뒤", // 실행 중 입력 전달 방식 followUp(이번 턴 뒤에 보냄)
  // 묶음 B(플러그인 UI와 신뢰, m4/pg-b). 병합 때 이 구역을 통째로 옮긴다.
  viewFallback: "대체 화면", // 프레임 금지 때 그리는 fallback 트리
  framesSetting: "플러그인 앱 허용", // x.views.frames
  projectFramesSetting: "프로젝트 확장의 플러그인 앱", // x.views.allowProjectFrames
  frameConfirm: "동작 확인", // 프레임 call 확인 줄(셸이 띄움)
  projectTrust: "프로젝트 신뢰", // O-04 폴더 신뢰(확장 신뢰 수준과 다름)
  trustConfirm: "확장 신뢰 확인", // O-10
  installFolder: "폴더", // 설치 출처: 확장 폴더
  installBundle: "묶음 파일", // 설치 출처: 패키징한 확장 파일
  installUserDir: "사용자 확장 위치", // install source user(<userDir>/extensions)
  extStorage: "확장 저장 데이터", // 확장 접두 테이블(상태 문서)
  slotOverflow: "더 보기", // 오른쪽 막대 플러그인 탭이 6개를 넘을 때 메뉴
  trustRequested: "요청한 신뢰 수준", // 매니페스트 trust.level
  trustEffective: "실제 신뢰 수준", // 유효 등급 = min(위치 상한, 요청)
  trustCeiling: "위치 상한", // 설치 위치가 정하는 상한(SOURCE_TRUST)
  trustRecheck: "신뢰 다시 확인", // 업데이트·권한 변경 뒤 O-10 차이 모드
  install: "가져오기", // 확장 설치(P-13 머리 단추)
  uninstall: "지우기", // 확장 제거
  installCheck: "검사", // 가져오기 전 매니페스트·파일 검사
  nextStage: "다음 단계", // M4 밖 기능 안내 표지(URL 설치 등)

  // 묶음 C(크래프트 테스트·버전·설정, m4/pg-c). 병합 때 이 구역을 통째로 옮긴다.
  repoPath: "저장소 경로", // 개발 모드를 켜려면 필요한 fresnel 저장소 위치(authoring §6)
  replayReport: "검사 보고", // ReplayDriveReport(결정 9)
  cutStrip: "절단 띠", // replay 커밋 시점마다 한 칸
  firstDiff: "첫 차이", // ReplayDriveReport.firstDiff
  boundaryLog: "단계 사이 기록", // 테스트 대화 상세의 경계 기록
  stepOnce: "한 단계씩", // 다음 단계 사이까지만 진행
  pastResult: "지난 결과", // 배포 앱에서 읽기 전용으로 남는 결과
  installHistory: "설치 이력", // 버전 탭 전체 단계(X-8)
  bundledVersion: "앱에 든 버전", // 버전 탭 대체 단계(기본 플러그인의 번들 버전)
  stateSchema: "저장 형식", // 확장 상태 스키마 버전
  migration: "형식 변환", // 상태 마이그레이션 훅
  clearAndRevert: "저장 데이터를 비우고 되돌리기", // 내려가는 형식 변환이 없을 때(결정 6)
  codeOnlyRevert: "코드만 되돌리기", // 형식 변환이 없을 때 대안: 저장 데이터는 남기고 코드만(2026-11-01 결정)
  valueSource: "값 출처", // 설정 탭: 이긴 범위·프로필·테스트
  writeTarget: "저장 위치", // 맥락이 프로필·테스트일 때 쓰기 대상
  viewLedger: "화면 실패 기록", // 클라이언트 화면 장부(view_disabled 5번)
  viewReenable: "화면 다시 켜기",
  hook: "훅", // X 훅(외부 훅). 층 열은 mono "X"
  hookEvent: "훅 이벤트", // hooks.list의 이벤트 이름
  enableScope: "켜는 범위", // 사용자·프로젝트·이 대화
  atBoundary: "이번 단계가 끝나면 적용", // "다음 단계 경계에 적용" 대기 배지(문장형)
  capabilityWait: "필요한 기능 기다림", // requires 미충족(기능 대기)
  editProfile: "프로필 고치기", // 맥락이 프로필일 때 켜기·끄기의 뜻
  trialOnly: "이 테스트에만", // 맥락이 테스트일 때 켜기·끄기의 뜻(session 범위)
  askSkip: "묻지 않기", // 프레임 동작 확인 줄의 "이 화면에서 묻지 않기"
  askAgain: "다시 묻기",
  uiLocale: "표시 언어", // l4.ui.locale
  // 묶음 B와 같은 키·값(정본은 B). 병합 때 B 구역과 겹치면 이 셋을 지운다.

  // 묶음 D(대화 영역 빈칸과 셸 수명, m4/pg-d). 병합 때 이 구역을 통째로 옮긴다.
  resume: "이어서 실행", // turn.resume 후보(비정상 종료 표식, L4.desktop §4.7). 띠 버튼·목록 배지
  fork: "분기", // thread.fork(대화 행 메뉴, 여기서 분기)
  xHook: "X 훅", // X 층 훅(hooks.list). 결정 12: 안전 모드에서 싣지 않음
  liveWork: "진행 중", // 상태 표시줄 host.status.liveTurns 칸(§6.3)
  backgroundWork: "백그라운드 작업", // 진행 중 Popover 제목(계획에 없음 10): 대화·테스트·예약·제작 대화
  appUpdate: "앱 업데이트", // 앱 안 업데이트(L4.release §5, 계획에 없음 1)
  exportThread: "대화 내보내기", // Markdown·JSON(계획에 없음 6)
  wipeData: "데이터 지우기", // 모든 대화·설정·시크릿 참조를 지움(계획에 없음 6, O-06 변형)
  osNotice: "OS 알림", // 앱 밖 알림(tauri-plugin-notification). 설정 탭 이름
  trayIcon: "메뉴 막대 아이콘", // 트레이(macOS 메뉴 막대, Linux·Windows 알림 영역)

  // 묶음 E(가로 품질, m4/pg-e). 병합 때 이 구역을 통째로 옮긴다.
  uiLanguage: "화면 언어", // ui.locale(ko·en). 영어 스모크(N-49, Y15)
  keybinding: "바로 가기 키", // O-09 제목·설정 행
  rebind: "키 바꾸기", // l4.desktop.appearance.keybindings(계획에 없음 11)
  keyConflict: "겹치는 키", // 다른 동작이나 브라우저가 이미 쓰는 키
  focusOrder: "초점 순서", // 키보드만 경로(N-50): 영역 바꾸기 → 보기 기준 칸 → 가운데 → well → 상태 표시줄
  reducedMotion: "움직임 줄이기", // prefers-reduced-motion
  highContrast: "고대비", // forced-colors·prefers-contrast
  profileManage: "프로필 관리", // N-57 목록·만들기·이름 바꾸기·복제·지우기
  editedElsewhere: "다른 곳에서 바뀜", // baseRev 충돌(다른 창·웹·앱이 먼저 저장)
  webClient: "웹", // 브라우저로 붙는 클라이언트(계획에 없음 7)
  serviceAddress: "서비스 주소", // 웹 첫 화면
  accessToken: "접속 토큰", // 웹 첫 화면 인증
  readOnly: "읽기 전용", // 좁은 폭 크래프트(계획에 없음 8)
  remoteTarget: "원격 대상", // 원격 엔진에 붙은 크래프트(N-60)
  copyPath: "경로 복사", // 원격에서 "폴더 열기"·"파일 열기" 대신
  productName: "Fresnel", // 제품 이름(아직 정하는 중). 화면에 보이는 제품 이름은 모두 이 키로, 바꿀 때 여기 하나만

  // 새 대화(O-07). 화면에 이미 있던 말을 옮긴 것이다.
  newThread: "새 대화",
  workFolder: "작업 폴더", // thread.create { workspace }
  folder: "폴더",

  // 묶음 F1(구성기 진입과 테스트, m4/redesign-f1-compose). 모두 spec §6.28에 이미 있는 말이다.
  composeFlow: "흐름", // 구성기 보기
  composeCode: "코드", // 구성기 보기
  phaseMachine: "단계 머신", // drive 블록의 단계 머신
  startPoint: "시작점", // 새 그룹의 시작점(복제 또는 종류)
  writeGuard: "쓰기 거부", // 가드 구간(tool.call.before first)
  trialPause: "멈춤", // trial.pause
  trialPausing: "멈추는 중", // 다음 단계 사이를 기다림
  trialResume: "이어서", // trial.resume
} as const;

export type TermKey = keyof typeof T_KO;

/** 화면 언어(?lang=en, 목업 전용)에 따라 한국어나 영어 용어 묶음. 영어 묶음은 모든 키를 가져야 한다(terms.en.ts 타입이 강제). */
export const T: { readonly [K in TermKey]: string } = LANG === "en" ? T_EN : T_KO;

/** 받침 여부로 조사를 고른다: josa("주도", "을", "를") → "주도를". 숫자는 한자어 읽기로 본다
 *  (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔은 받침 있음: "0.4.0이"). 영문으로 끝나면 둘째를 쓴다. */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    const jong = (last - 0xac00) % 28;
    // ㄹ 받침 뒤 "으로"는 "로"(묶음 D).
    if (jong === 8 && withFinal === "으로") return word + withoutFinal;
    return word + (jong === 0 ? withoutFinal : withFinal);
  }
  // 숫자로 끝나면 읽는 소리 기준(묶음 B에서 가져옴): 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔은 받침.
  const ch = word.charAt(word.length - 1);
  if (ch >= "0" && ch <= "9") {
    if (withFinal === "으로" && "178".includes(ch)) return word + withoutFinal;
    return word + ("013678".includes(ch) ? withFinal : withoutFinal);
  }
  const ch = word.charAt(word.length - 1);
  if (ch >= "0" && ch <= "9") return word + ("013678".includes(ch) ? withFinal : withoutFinal);
  return word + withoutFinal;
}
