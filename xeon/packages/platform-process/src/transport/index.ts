export {
  createInProcessPair,
  createInProcessPairWith,
  type InProcessMode,
  type InProcessPairOptions,
} from "./in-process.ts";
// 줄 프레이밍과 stdio 전송 구현은 F `@xeon/contracts/wire`에 있다(런타임 중립). 기존 import 경로를 지키려고 다시 낸다.
export {
  createLineFramer,
  createStdioTransport,
  createStdioTransportWith,
  encodeFrame,
  rejectionFrame,
  type EncodeError,
  type FrameEvent,
  type FrameProblem,
  type LineFramer,
  type LineFramerOptions,
  type StdioTransportDeps,
} from "@xeon/contracts/wire";
export {
  openProcessStdio,
  writableFromSink,
  type ByteSink,
  type ByteStreams,
} from "./process-stdio.ts";
export {
  connectSocket,
  isLoopbackHost,
  listenSocket,
  UNIX_SOCKET_PATH_LIMIT,
  type PeerInfo,
  type SocketConnectOptions,
  type SocketError,
  type SocketListenOptions,
  type SocketListener,
} from "./socket.ts";
export {
  openTunnel,
  sshTunnelCommand,
  type SocketTunnel,
  type SshTunnelError,
  type SshTunnelInput,
  type TunnelDeps,
  type TunnelError,
  type TunnelExit,
  type TunnelSpec,
} from "./tunnel.ts";
