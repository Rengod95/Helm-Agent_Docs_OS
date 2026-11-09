// 셸 명령 표. 게이트웨이가 탭마다 어떤 명령을 등록할지 한 곳에서 정한다(L4.remote.spec §6.1).
// 표에 없는 명령은 등록하지 않는다(기본 거부). src/main에 명령을 더하면 시험(commands-table.test.ts)이 이 표에 항목을 요구한다.

/** 명령이 어디서 답하는가 */
export type Disposition =
  /**
   * 게이트웨이 프로세스의 탭별 레지스트리(origin)에 등록한다.
   * `gap`이 있으면 웹 명세에는 origin이지만 아직 구현되지 않았다. 그 명령은 등록하지 않아 `unknown-command`로 답한다.
   */
  | { readonly kind: "origin"; readonly gap?: string }
  /** 브라우저 shim이 답한다. 서버는 등록하지 않는다 */
  | { readonly kind: "browser" }
  /** 웹에서는 쓸 수 없다. 등록하지 않아 `unknown-command`로 답한다 */
  | { readonly kind: "hidden" }
  /** 세션이 웹 값을 직접 답한다(`web-context.ts`) */
  | { readonly kind: "web-specific" };

const ORIGIN: Disposition = { kind: "origin" };
const BROWSER: Disposition = { kind: "browser" };
const HIDDEN: Disposition = { kind: "hidden" };
const WEB_SPECIFIC: Disposition = { kind: "web-specific" };

/** 폴더 선택 대화 상자는 서버의 OS 창이라 브라우저에서 쓸 수 없다. 원격 폴더 고르기 화면과 핸들 명령이 필요하다 */
const FOLDER_PICKER_GAP =
  "웹 '서버 폴더 고르기' 화면과 핸들을 만드는 명령의 모양이 아직 없다(L4.remote.spec §6.1, W4)";
/** 데스크톱 설정 모듈은 origin 데스크톱의 설정 파일을 읽고 쓴다. 웹 기기별 기록은 아직 없다 */
const DESKTOP_SETTINGS_GAP =
  "웹 기기별 설정 기록(origin 기기 레코드, §6.1 [제안])이 아직 없다. 데스크톱 모듈은 origin 데스크톱의 설정 파일을 쓰므로 웹에 등록하지 않는다";

/** 명령 이름 → 처리 위치. 표에 없는 이름은 `dispositionOf`가 `undefined`로 답한다 */
export const COMMAND_TABLE: Readonly<Record<string, Disposition>> = {
  // 엔진(L4.remote.spec §6.1 1행). 탭마다 서비스 소켓 연결 하나다
  engine_attach: ORIGIN,
  engine_write: ORIGIN,
  engine_ack: ORIGIN,
  engine_detach: ORIGIN,
  engine_restart: ORIGIN,
  engine_retarget: HIDDEN,
  db_restore: ORIGIN,

  // 백업과 저장 공간(같은 origin, 데스크톱과 같은 권한, §8.6)
  db_export: ORIGIN,
  db_usage: ORIGIN,
  db_previous_remove: ORIGIN,
  open_data_dir: HIDDEN,

  // 폴더 선택과 폴더 안 읽기
  pick_folder: { kind: "origin", gap: FOLDER_PICKER_GAP },
  pick_folder_open: { kind: "origin", gap: FOLDER_PICKER_GAP },
  folder_list: ORIGIN,
  folder_read: ORIGIN,
  // 서버의 OS 파일 대화 상자는 웹에서 쓸 수 없다. 첨부 경로 처리는 W4가 정한다(UI의 `pick_file` 호출자가 있다)
  pick_file: HIDDEN,
  pick_file_read: BROWSER,
  save_file: BROWSER,
  open_external: BROWSER,
  open_log_dir: HIDDEN,

  // 알림과 트레이
  notify_permission: BROWSER,
  notify_request_permission: BROWSER,
  notify_os: BROWSER,
  notify_take_target: ORIGIN,
  shell_take_intents: ORIGIN,
  tray_update: BROWSER,

  // 앱 업데이트와 재인증
  update_status: HIDDEN,
  update_check: HIDDEN,
  update_download: HIDDEN,
  update_install_restart: HIDDEN,
  os_reauth: HIDDEN,

  // 키 등록과 설정
  secret_register: ORIGIN,
  desktop_settings_read: { kind: "origin", gap: DESKTOP_SETTINGS_GAP },
  desktop_settings_write: { kind: "origin", gap: DESKTOP_SETTINGS_GAP },

  // 프레임 root 목록(탭별)
  app_roots_set: ORIGIN,

  // 서비스 상태, 켜기, 끄기(§8.6의 "서비스 끄기"는 웹 기기에서도 허용한다)
  service_status: ORIGIN,
  service_ensure: ORIGIN,
  service_stop: ORIGIN,

  // 기능 감지. 웹과 데스크톱이 다른 값을 돌려준다(§6.1 [제안])
  shell_capabilities: WEB_SPECIFIC,
};

/** 명령의 처리 위치. 표에 없으면 `undefined`다 */
export function dispositionOf(command: string): Disposition | undefined {
  return Object.hasOwn(COMMAND_TABLE, command) ? COMMAND_TABLE[command] : undefined;
}

/** 게이트웨이가 탭의 레지스트리에 등록하는 명령인가(origin이고 구현이 있는 것) */
export function isServedByGateway(command: string): boolean {
  const disposition = dispositionOf(command);
  return (
    disposition !== undefined && disposition.kind === "origin" && disposition.gap === undefined
  );
}
