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

/**
 * 플러그인 화면의 폴더 고르기(`pick_folder_open`)는 웹에서 경로로 핸들을 만드는 명령이 필요하다. W4 범위가 아니다.
 * 웹 화면의 서버 폴더 고르기는 `origin_folder_list`와 자체 대화 상자가 맡는다.
 */
const FOLDER_PICKER_GAP =
  "플러그인 화면의 폴더 고르기는 웹에서 경로로 핸들을 만드는 명령이 필요하다. W4 범위가 아니다(L4.remote.spec §6.1)";

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

  // 폴더 선택과 폴더 안 읽기. 웹의 서버 폴더 고르기는 `origin_folder_list`가 한다(origin-folders.ts)
  pick_folder: HIDDEN,
  pick_folder_open: { kind: "origin", gap: FOLDER_PICKER_GAP },
  folder_list: ORIGIN,
  folder_read: ORIGIN,
  origin_folder_list: ORIGIN,
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

  // 키 등록과 설정. 웹은 기기마다 파일 하나에 쓴다(device-settings.ts). 창 닫기와 엔진 키는 거절한다
  secret_register: ORIGIN,
  desktop_settings_read: ORIGIN,
  desktop_settings_write: ORIGIN,

  // 프레임 root 목록(탭별)
  app_roots_set: ORIGIN,
  // 웹의 프레임 주소 접두(권한 토큰). 데스크톱은 `fresnel-view://`라 이 명령이 없다(spec §6.3)
  view_root: WEB_SPECIFIC,

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
