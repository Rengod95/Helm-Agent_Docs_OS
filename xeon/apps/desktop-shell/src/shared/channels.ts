/** 메인 프로세스와 preload가 같이 쓰는 IPC 채널 이름. UI 쪽 어댑터(apps/desktop/src/shell)가 아는 이름은 이 값들뿐이다. */
export const SHELL_CHANNELS = {
  /** renderer → main: `invoke(command, args)` 요청 */
  invoke: "fresnel:invoke",
  /** main → renderer: 채널 메시지 `(id, message)` */
  channel: "fresnel:channel",
  /** main → renderer: 이름 붙은 이벤트 `(name)` */
  event: "fresnel:event",
} as const;

/** args 안에서 renderer가 만든 채널을 가리키는 값. preload가 `openChannel`로 번호를 받아 `{ $channel: id }`로 넘긴다 */
export const CHANNEL_KEY = "$channel";
