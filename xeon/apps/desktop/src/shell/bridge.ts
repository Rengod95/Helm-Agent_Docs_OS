// L4.desktop.design §15.1. UI가 셸(Tauri 또는 Electron)을 부르는 길을 한 곳으로 모은다.
// 화면과 transport는 이 인터페이스만 안다. 어느 셸인지는 실행 때 `selectShellBridge`가 고른다.

export type ShellKind = "tauri" | "electron";

export type ShellArgs = Readonly<Record<string, unknown>>;

export interface ShellBridge {
  readonly kind: ShellKind;
  /** 명령을 부른다. 셸이 거절하면 그 거절 값(문자열 코드나 `{kind}`)으로 거부된다 */
  invoke(command: string, args?: ShellArgs): Promise<unknown>;
  /** 본문이 원시 바이트인 명령(`engine_write`, `secret_register`). 헤더는 세대 같은 짧은 값이다 */
  invokeBytes(
    command: string,
    body: Uint8Array,
    headers?: Readonly<Record<string, string>>,
  ): Promise<unknown>;
  /** 셸이 메시지를 보낼 채널을 만든다. 돌려준 값은 불투명하다: 그대로 `invoke`의 args에 넣는다 */
  createChannel(onMessage: (message: unknown) => void): unknown;
  /** 이름 붙은 셸 이벤트를 듣는다. 돌려주는 함수가 듣기를 끝낸다 */
  listen(event: string, onEvent: () => void): Promise<() => void>;
}
