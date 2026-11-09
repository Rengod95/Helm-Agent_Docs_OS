// 탭 세션과 서버가 맞물리는 면. 서버(`server/`)는 이 인터페이스만 알고 세션 구현을 모른다.

/** `/shell` 연결 하나(기기 하나의 브라우저 탭 하나)의 셸. 탭마다 레지스트리·릴레이·채널 표가 따로다 */
export interface TabSession {
  /** 브라우저가 보낸 텍스트 프레임 하나(`ClientFrame`의 JSON). 모양이 틀리면 조용히 무시하지 않고 연결을 닫는다 */
  receive(text: string): void;
  /** 연결이 끝났다. 서비스 소켓 연결, 대기 중인 쓰기, 채널을 정리한다. 여러 번 불러도 된다 */
  close(): void;
}

export interface TabSessionInput {
  readonly deviceId: string;
  readonly deviceName: string;
  /** 브라우저로 텍스트 프레임을 보낸다(`ServerFrame`의 JSON). 연결이 이미 닫혔으면 아무 일도 없다 */
  readonly send: (text: string) => void;
  /** 세션이 스스로 연결을 닫을 때(프로토콜 위반) */
  readonly closeConnection: (code: number, reason: string) => void;
}

/** 서버가 `/shell` 업그레이드마다 부른다 */
export interface TabSessionFactory {
  open(input: TabSessionInput): TabSession;
}
