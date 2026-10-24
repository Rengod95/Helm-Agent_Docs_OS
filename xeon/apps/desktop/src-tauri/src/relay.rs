//! 엔진 stdout 바이트를 WebView로, WebView 쓰기를 엔진 stdin으로 중계한다 (L4.desktop.spec 3.3, 4.5).
//!
//! DESK.1 spike S3가 세운 조건 세 가지를 지킨다(L4.desktop.plan 3.1.1).
//!
//! 1. 신용 기반 역압: 보낸 바이트와 WebView가 처리했다고 알린(`engine_ack`) 바이트의 차가 창을 넘으면
//!    더 보내지 않는다. 엔진 stdout 읽기가 멈추고 역압이 엔진까지 전달된다. `Channel`을 무제어로 쓰지 않는다.
//! 2. stdin 쓰기는 비동기 명령이고 전용 스레드가 한다. 막힌 쓰기가 앱 상태의 락을 쥐지 않으므로
//!    종료 경로는 쓰기 뒤에 줄을 서지 않는다.
//! 3. 줄 버퍼는 엔진 세대마다 따로 두고 종료 때 꼬리를 버린다. 줄 경계는 새로 온 조각에서만 찾는다.
//!
//! 셸은 JSON을 해석하지 않는다. 아는 것은 줄 경계(`\n`)뿐이다.

use std::io;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::State;
use tokio::sync::{mpsc, Notify};

use crate::engine::{AppSupervisor, EngineState};

/// 신용 창. 보낸 바이트에서 처리 확인된 바이트를 뺀 값이 이 값 이하일 때만 다음 묶음을 보낸다.
pub const CREDIT_WINDOW_BYTES: u64 = 4 * 1024 * 1024;
/// WebView가 처리한 바이트가 이만큼 쌓일 때마다 `engine_ack`를 부른다(WebView 쪽 약속).
/// 창이 이 값의 몇 배여야 확인이 늦어도 송신이 멎지 않는다.
pub const ACK_STEP_BYTES: u64 = 256 * 1024;
/// 줄 끝이 오지 않은 채 이 길이를 넘으면 그 줄을 버린다(프레임 한도 1 MiB의 두 배, 메모리 상한).
pub const MAX_PENDING_LINE_BYTES: usize = 2 * 1024 * 1024;
/// `engine_write` 한 번에 실을 수 있는 크기. 줄(프레임) 단위로 보낸다.
pub const MAX_WRITE_BYTES: usize = 2 * 1024 * 1024;
/// 쓰기 대기열 한도(메시지 수). 차면 `engine_write`가 비동기로 기다린다.
pub const WRITE_QUEUE_FRAMES: usize = 16;

const _: () = assert!(CREDIT_WINDOW_BYTES >= 4 * ACK_STEP_BYTES);
const _: () = assert!(MAX_PENDING_LINE_BYTES >= 1_048_576);

// ---------------------------------------------------------------------------------------------
// 명령 오류

/// WebView로 돌려주는 오류 코드. 직렬화하면 kebab-case 문자열이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CommandError {
    /// 세대(epoch)가 현재 연결과 다르다. 이전 페이지의 늦은 쓰기가 새 연결에 섞이지 않게 거부한다.
    EpochStale,
    EngineNotRunning,
    EngineStopping,
    /// `failed`가 아닐 때 `engine_restart`를 불렀다.
    NotFailed,
    TooLarge,
    BadRequest,
}

// ---------------------------------------------------------------------------------------------
// 줄 버퍼

/// 엔진 세대 하나의 stdout 줄 버퍼. 완성된 줄만 내보내고 꼬리(줄 끝이 없는 조각)는 쥐고 있는다.
pub struct LineBuffer {
    tail: Vec<u8>,
    /// 새 수신자에게 넘기기 전에 앞부분이 버려진 줄의 나머지를 다음 `\n`까지 버리는 중이다.
    skipping: bool,
    limit: usize,
    overflowed: u64,
}

impl LineBuffer {
    pub fn new(limit: usize) -> Self {
        Self {
            tail: Vec::new(),
            skipping: false,
            limit,
            overflowed: 0,
        }
    }

    /// 조각을 넣고, 마지막 `\n`까지의 완성된 줄을 돌려준다. 줄 경계는 `chunk`에서만 찾는다.
    /// 꼬리가 비어 있고 조각이 `\n`으로 끝나면 같은 `Vec`을 그대로 돌려준다(복사 없음).
    pub fn push(&mut self, mut chunk: Vec<u8>) -> Option<Vec<u8>> {
        if self.skipping {
            match memchr::memchr(b'\n', &chunk) {
                None => return None,
                Some(at) => {
                    chunk.drain(..=at);
                    self.skipping = false;
                }
            }
        }
        if chunk.is_empty() {
            return None;
        }
        match memchr::memrchr(b'\n', &chunk) {
            None => {
                self.tail.extend_from_slice(&chunk);
                self.enforce_limit();
                None
            }
            Some(last) => {
                let rest_from = last + 1;
                let out = if self.tail.is_empty() {
                    let rest = chunk.split_off(rest_from);
                    self.tail = rest;
                    chunk
                } else {
                    let mut out = std::mem::take(&mut self.tail);
                    out.extend_from_slice(&chunk[..rest_from]);
                    self.tail.extend_from_slice(&chunk[rest_from..]);
                    out
                };
                self.enforce_limit();
                Some(out)
            }
        }
    }

    /// 수신자가 바뀌었다(WebView 새로고침). 지금 쥔 꼬리는 새 수신자가 앞부분을 못 본 줄이므로
    /// 버리고, 그 줄의 나머지도 다음 `\n`까지 버린다.
    pub fn discard_partial(&mut self) {
        if !self.tail.is_empty() {
            self.tail.clear();
            self.skipping = true;
        }
    }

    /// 엔진 세대가 끝났다. 줄 끝이 오지 않은 꼬리를 버리고 그 바이트 수를 돌려준다.
    pub fn finish(self) -> (usize, u64) {
        (self.tail.len(), self.overflowed)
    }

    fn enforce_limit(&mut self) {
        if self.tail.len() > self.limit {
            self.tail = Vec::new();
            self.skipping = true;
            self.overflowed += 1;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 신용

/// 신용 창이 닫혔다(수신자가 바뀌었거나 종료 중이다).
#[derive(Debug, PartialEq, Eq)]
pub struct CreditClosed;

#[derive(Default)]
struct CreditState {
    sent: u64,
    acked: u64,
    closed: bool,
}

/// 수신자 하나(attach 하나)의 송신 신용.
pub struct Credit {
    window: u64,
    state: Mutex<CreditState>,
    notify: Notify,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // 다른 스레드가 패닉했더라도 상태는 단순한 정수라 계속 쓴다.
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl Credit {
    pub fn new(window: u64) -> Self {
        Self {
            window,
            state: Mutex::new(CreditState::default()),
            notify: Notify::new(),
        }
    }

    /// 미확인 바이트가 창 이하가 될 때까지 기다린 뒤 `bytes`를 보낸 양에 더한다.
    /// 한 묶음이 창보다 커도 미확인 바이트가 0이면 보낸다(멈추지 않는다).
    pub async fn acquire(&self, bytes: u64) -> Result<(), CreditClosed> {
        loop {
            let notified = self.notify.notified();
            {
                let mut state = locked(&self.state);
                if state.closed {
                    return Err(CreditClosed);
                }
                if state.sent.saturating_sub(state.acked) <= self.window {
                    state.sent = state.sent.saturating_add(bytes);
                    return Ok(());
                }
            }
            notified.await;
        }
    }

    /// WebView가 `bytes`만큼 처리했다. 보낸 양을 넘는 확인은 보낸 양으로 줄인다.
    pub fn ack(&self, bytes: u64) {
        {
            let mut state = locked(&self.state);
            state.acked = state.acked.saturating_add(bytes).min(state.sent);
        }
        self.notify.notify_waiters();
    }

    pub fn close(&self) {
        locked(&self.state).closed = true;
        self.notify.notify_waiters();
    }

    #[cfg(test)]
    pub fn outstanding(&self) -> u64 {
        let state = locked(&self.state);
        state.sent.saturating_sub(state.acked)
    }
}

// ---------------------------------------------------------------------------------------------
// 릴레이

#[derive(Debug, PartialEq, Eq)]
pub struct SinkClosed;

/// WebView 쪽 수신 끝. 운영에서는 Tauri `Channel` 둘이고 시험에서는 가짜다.
pub trait Sink: Send + Sync {
    fn send_bytes(&self, bytes: Vec<u8>) -> Result<(), SinkClosed>;
    fn send_state(&self, state: &EngineState) -> Result<(), SinkClosed>;
}

/// `engine_attach`가 돌려주는 값.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AttachResult {
    pub epoch: u64,
    pub state: EngineState,
}

#[derive(Clone)]
struct Attached {
    epoch: u64,
    sink: Arc<dyn Sink>,
    credit: Arc<Credit>,
}

struct RelayInner {
    last_epoch: u64,
    attached: Option<Attached>,
    state: EngineState,
}

pub struct Relay {
    inner: Mutex<RelayInner>,
    /// 현재 attach의 세대. 0은 아직 attach가 없었다는 뜻이다.
    epoch: AtomicU64,
    /// 종료 중이다. 새 바이트를 보내지 않고 버려서 엔진 쪽 파이프가 막히지 않게 한다.
    draining: AtomicBool,
}

/// 엔진 세대 하나가 끝난 뒤의 집계. 로그에는 이 숫자만 남긴다(L4.desktop.spec E11).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct StreamStats {
    pub forwarded_bytes: u64,
    pub dropped_bytes: u64,
    pub dropped_tail_bytes: usize,
    pub overflowed_lines: u64,
}

impl Relay {
    pub fn new(initial: EngineState) -> Self {
        Self {
            inner: Mutex::new(RelayInner {
                last_epoch: 0,
                attached: None,
                state: initial,
            }),
            epoch: AtomicU64::new(0),
            draining: AtomicBool::new(false),
        }
    }

    /// 페이지 하나를 붙인다. 이전 페이지의 릴레이는 끊긴다.
    pub fn attach(&self, sink: Arc<dyn Sink>) -> AttachResult {
        let mut inner = locked(&self.inner);
        if let Some(old) = inner.attached.take() {
            old.credit.close();
        }
        inner.last_epoch += 1;
        let epoch = inner.last_epoch;
        self.epoch.store(epoch, Ordering::SeqCst);
        let credit = Arc::new(Credit::new(CREDIT_WINDOW_BYTES));
        if self.draining.load(Ordering::SeqCst) {
            credit.close();
        }
        inner.attached = Some(Attached {
            epoch,
            sink,
            credit,
        });
        AttachResult {
            epoch,
            state: inner.state.clone(),
        }
    }

    /// `epoch`가 현재 연결일 때만 끊는다. 늦게 온 이전 페이지의 detach가 새 연결을 끊지 못한다.
    pub fn detach(&self, epoch: u64) -> bool {
        let mut inner = locked(&self.inner);
        Self::detach_locked(&mut inner, epoch)
    }

    /// 창이 사라졌다. 현재 연결을 끊는다.
    pub fn detach_current(&self) {
        let mut inner = locked(&self.inner);
        if let Some(epoch) = inner.attached.as_ref().map(|a| a.epoch) {
            Self::detach_locked(&mut inner, epoch);
        }
    }

    fn detach_locked(inner: &mut RelayInner, epoch: u64) -> bool {
        match &inner.attached {
            Some(attached) if attached.epoch == epoch => {
                attached.credit.close();
                inner.attached = None;
                true
            }
            _ => false,
        }
    }

    pub fn check_epoch(&self, epoch: u64) -> Result<(), CommandError> {
        let current = self.epoch.load(Ordering::SeqCst);
        if current != 0 && current == epoch && locked(&self.inner).attached.is_some() {
            Ok(())
        } else {
            Err(CommandError::EpochStale)
        }
    }

    /// WebView가 `bytes`만큼 처리했다. 세대가 다르면 무시한다.
    pub fn ack(&self, epoch: u64, bytes: u64) -> bool {
        let credit = {
            let inner = locked(&self.inner);
            match &inner.attached {
                Some(attached) if attached.epoch == epoch => Some(attached.credit.clone()),
                _ => None,
            }
        };
        match credit {
            Some(credit) => {
                credit.ack(bytes);
                true
            }
            None => false,
        }
    }

    #[cfg(test)]
    pub fn state(&self) -> EngineState {
        locked(&self.inner).state.clone()
    }

    /// 상태를 기록하고 붙어 있는 페이지에 알린다.
    pub fn set_state(&self, state: EngineState) {
        let mut inner = locked(&self.inner);
        inner.state = state.clone();
        let failed = inner
            .attached
            .as_ref()
            .map(|a| (a.epoch, a.sink.send_state(&state).is_err()));
        if let Some((epoch, true)) = failed {
            Self::detach_locked(&mut inner, epoch);
        }
    }

    /// 종료가 시작됐다. 이후 바이트는 보내지 않고 버린다. 대기 중이던 송신도 풀어 준다.
    pub fn begin_drain(&self) {
        self.draining.store(true, Ordering::SeqCst);
        if let Some(attached) = &locked(&self.inner).attached {
            attached.credit.close();
        }
    }

    fn current(&self) -> Option<Attached> {
        locked(&self.inner).attached.clone()
    }

    /// 엔진 세대 하나의 stdout 읽기 쪽을 연다. 세대마다 호출하고 줄 버퍼가 따로다.
    pub fn open_stream(self: &Arc<Self>) -> EngineStream {
        EngineStream {
            relay: self.clone(),
            buffer: LineBuffer::new(MAX_PENDING_LINE_BYTES),
            seen_epoch: self.epoch.load(Ordering::SeqCst),
            stats: StreamStats::default(),
        }
    }
}

/// 엔진 세대 하나의 stdout 흐름. 읽기 작업 하나가 `push`를 순서대로 부른다.
pub struct EngineStream {
    relay: Arc<Relay>,
    buffer: LineBuffer,
    seen_epoch: u64,
    stats: StreamStats,
}

impl EngineStream {
    /// 엔진 stdout 조각 하나를 처리한다. 신용이 찰 때까지 기다리는 동안 호출자(엔진 이벤트 읽기)도
    /// 멈추므로 역압이 엔진의 stdout 쓰기까지 이어진다.
    pub async fn push(&mut self, chunk: Vec<u8>) {
        let epoch = self.relay.epoch.load(Ordering::SeqCst);
        if epoch != self.seen_epoch {
            self.buffer.discard_partial();
            self.seen_epoch = epoch;
        }
        let Some(batch) = self.buffer.push(chunk) else {
            return;
        };
        let size = batch.len() as u64;
        let target = if self.relay.draining.load(Ordering::SeqCst) {
            None
        } else {
            self.relay.current()
        };
        let Some(attached) = target else {
            self.stats.dropped_bytes += size;
            return;
        };
        if attached.credit.acquire(size).await.is_err() {
            self.stats.dropped_bytes += size;
            return;
        }
        match attached.sink.send_bytes(batch) {
            Ok(()) => self.stats.forwarded_bytes += size,
            Err(SinkClosed) => {
                self.stats.dropped_bytes += size;
                self.relay.detach(attached.epoch);
            }
        }
    }

    /// 세대가 끝났다. 줄 끝이 오지 않은 꼬리를 버린다.
    pub fn finish(self) -> StreamStats {
        let (tail, overflowed) = self.buffer.finish();
        StreamStats {
            dropped_tail_bytes: tail,
            overflowed_lines: overflowed,
            ..self.stats
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 엔진 stdin 쓰기

/// 엔진 stdin. 운영에서는 `CommandChild`를 감싼 것이고 시험에서는 가짜다.
pub trait StdinSink: Send + 'static {
    fn write_all(&mut self, bytes: &[u8]) -> io::Result<()>;
}

enum PipeCmd {
    /// `boundary`가 참이면 앞선 쓰기가 줄 끝으로 끝나지 않았을 때 `\n`을 먼저 써서 프레임 경계를 맞춘다.
    Frame { bytes: Vec<u8>, boundary: bool },
    Close,
}

#[derive(Debug, PartialEq, Eq)]
pub struct PipeClosed;

/// 쓰기 전용 스레드의 손잡이. 복제해서 쓴다. 이 손잡이를 쥐는 동안 앱 상태의 락은 필요 없다.
#[derive(Clone)]
pub struct PipeHandle {
    tx: mpsc::Sender<PipeCmd>,
}

/// stdin 쓰기 전용 스레드를 띄운다. 스레드는 쓰기가 막혀도 다른 작업을 막지 않는다.
/// 스레드가 끝나면(닫기 요청, 쓰기 오류, 모든 손잡이 해제) `sink`가 해제되어 엔진 stdin이 닫힌다(EOF).
pub fn spawn_pipe_writer(sink: Box<dyn StdinSink>, capacity: usize) -> io::Result<PipeHandle> {
    let (tx, rx) = mpsc::channel(capacity);
    std::thread::Builder::new()
        .name("engine-stdin".into())
        .spawn(move || run_writer(sink, rx))?;
    Ok(PipeHandle { tx })
}

fn run_writer(mut sink: Box<dyn StdinSink>, mut rx: mpsc::Receiver<PipeCmd>) {
    let mut at_boundary = true;
    while let Some(cmd) = rx.blocking_recv() {
        match cmd {
            PipeCmd::Frame { bytes, boundary } => {
                if boundary && !at_boundary {
                    if sink.write_all(b"\n").is_err() {
                        return;
                    }
                    at_boundary = true;
                }
                if bytes.is_empty() {
                    continue;
                }
                if sink.write_all(&bytes).is_err() {
                    return;
                }
                at_boundary = bytes.last() == Some(&b'\n');
            }
            PipeCmd::Close => return,
        }
    }
}

impl PipeHandle {
    /// WebView가 보낸 바이트를 대기열에 넣는다. 대기열이 차면 비동기로 기다린다.
    pub async fn write_frame(&self, bytes: Vec<u8>) -> Result<(), PipeClosed> {
        self.tx
            .send(PipeCmd::Frame {
                bytes,
                boundary: false,
            })
            .await
            .map_err(|_| PipeClosed)
    }

    /// 셸이 직접 쓰는 프레임(`host.shutdown`). 앞선 쓰기가 줄 중간에서 끝났으면 줄을 먼저 닫는다.
    pub async fn write_shell_frame(&self, bytes: Vec<u8>) -> Result<(), PipeClosed> {
        self.tx
            .send(PipeCmd::Frame {
                bytes,
                boundary: true,
            })
            .await
            .map_err(|_| PipeClosed)
    }

    /// 대기열의 쓰기가 끝난 뒤 stdin을 닫는다(EOF).
    pub async fn close_write(&self) -> Result<(), PipeClosed> {
        self.tx.send(PipeCmd::Close).await.map_err(|_| PipeClosed)
    }
}

// ---------------------------------------------------------------------------------------------
// Tauri 연결: 수신 끝과 명령

/// 페이지의 `Channel` 둘을 묶은 수신 끝.
struct ChannelSink {
    bytes: Channel<InvokeResponseBody>,
    state: Channel<EngineState>,
}

impl Sink for ChannelSink {
    fn send_bytes(&self, bytes: Vec<u8>) -> Result<(), SinkClosed> {
        self.bytes
            .send(InvokeResponseBody::Raw(bytes))
            .map_err(|_| SinkClosed)
    }

    fn send_state(&self, state: &EngineState) -> Result<(), SinkClosed> {
        self.state.send(state.clone()).map_err(|_| SinkClosed)
    }
}

/// 현재 페이지에 릴레이를 붙인다. 이전 세대 릴레이는 끊는다.
#[tauri::command]
pub async fn engine_attach(
    relay: State<'_, Arc<Relay>>,
    on_bytes: Channel<InvokeResponseBody>,
    on_state: Channel<EngineState>,
) -> Result<AttachResult, CommandError> {
    Ok(relay.attach(Arc::new(ChannelSink {
        bytes: on_bytes,
        state: on_state,
    })))
}

/// 엔진 stdin에 쓴다. 원시 바이트 본문과 헤더 `x-xeon-epoch`를 받는다. 세대가 다르면 아무것도 쓰지 않는다.
#[tauri::command]
pub async fn engine_write(
    relay: State<'_, Arc<Relay>>,
    supervisor: State<'_, Arc<AppSupervisor>>,
    request: Request<'_>,
) -> Result<(), CommandError> {
    let epoch = request
        .headers()
        .get("x-xeon-epoch")
        .and_then(|value| value.to_str().ok())
        .and_then(|text| text.parse::<u64>().ok())
        .ok_or(CommandError::BadRequest)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::BadRequest);
    };
    if bytes.len() > MAX_WRITE_BYTES {
        return Err(CommandError::TooLarge);
    }
    relay.check_epoch(epoch)?;
    supervisor.write(bytes.clone()).await
}

/// WebView가 `bytes`만큼 처리했다고 알린다. 신용을 돌려준다.
#[tauri::command]
pub async fn engine_ack(
    relay: State<'_, Arc<Relay>>,
    epoch: u64,
    bytes: u64,
) -> Result<(), CommandError> {
    relay.ack(epoch, bytes);
    Ok(())
}

/// `failed` 상태에서 사용자가 수동 재기동을 고를 때 부른다.
#[tauri::command]
pub async fn engine_restart(
    supervisor: State<'_, Arc<AppSupervisor>>,
) -> Result<(), CommandError> {
    supervisor.restart_manually()
}

/// 페이지가 내려갈 때 릴레이를 끊는다. 엔진은 끄지 않는다. `epoch`가 현재 연결일 때만 끊는다.
#[tauri::command]
pub async fn engine_detach(relay: State<'_, Arc<Relay>>, epoch: u64) -> Result<(), CommandError> {
    relay.detach(epoch);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::EngineState;
    use std::sync::Condvar;
    use std::time::Duration;
    use tokio::time::timeout;

    // ----- LineBuffer -----

    fn buf() -> LineBuffer {
        LineBuffer::new(MAX_PENDING_LINE_BYTES)
    }

    #[test]
    fn line_buffer_holds_the_tail_until_the_newline_arrives() {
        let mut b = buf();
        assert_eq!(b.push(b"{\"a\":".to_vec()), None);
        assert_eq!(b.push(b"1}\n{\"b\"".to_vec()), Some(b"{\"a\":1}\n".to_vec()));
        assert_eq!(b.push(b":2}\n".to_vec()), Some(b"{\"b\":2}\n".to_vec()));
        assert_eq!(b.finish(), (0, 0));
    }

    #[test]
    fn line_buffer_returns_several_lines_in_one_batch() {
        let mut b = buf();
        assert_eq!(b.push(b"a\nb\nc".to_vec()), Some(b"a\nb\n".to_vec()));
        assert_eq!(b.push(b"d\n".to_vec()), Some(b"cd\n".to_vec()));
    }

    #[test]
    fn line_buffer_passes_a_whole_chunk_without_copying() {
        let mut b = buf();
        let chunk = b"x\ny\n".to_vec();
        let ptr = chunk.as_ptr();
        let out = b.push(chunk).expect("complete lines");
        assert_eq!(out.as_ptr(), ptr);
    }

    #[test]
    fn line_buffer_finish_reports_the_dropped_tail() {
        let mut b = buf();
        assert_eq!(b.push(b"half a fra".to_vec()), None);
        assert_eq!(b.finish(), (10, 0));
    }

    /// 세대마다 버퍼가 따로이면 이전 세대의 꼬리가 새 세대의 첫 줄에 붙지 않는다(spike E 경우).
    #[test]
    fn separate_buffers_per_generation_keep_a_dead_tail_from_gluing() {
        let mut old = buf();
        assert_eq!(old.push(b"{\"id\":\"1\",\"resu".to_vec()), None);
        let (dropped, _) = old.finish();
        assert_eq!(dropped, 15);
        let mut new = buf();
        assert_eq!(
            new.push(b"{\"id\":\"2\"}\n".to_vec()),
            Some(b"{\"id\":\"2\"}\n".to_vec())
        );
    }

    #[test]
    fn a_single_shared_buffer_would_glue_them() {
        // 비교군: 세대를 구분하지 않으면 새 세대의 첫 줄이 꼬리와 붙어 깨진다.
        let mut shared = buf();
        shared.push(b"{\"id\":\"1\",\"resu".to_vec());
        let glued = shared.push(b"{\"id\":\"2\"}\n".to_vec()).expect("line");
        assert_eq!(glued, b"{\"id\":\"1\",\"resu{\"id\":\"2\"}\n".to_vec());
    }

    #[test]
    fn new_listener_drops_the_partial_line_through_the_next_newline() {
        let mut b = buf();
        assert_eq!(b.push(b"head-of-frame ".to_vec()), None);
        b.discard_partial();
        // 앞부분을 못 본 줄의 나머지는 다음 \n까지 버린다.
        assert_eq!(b.push(b"rest\n{\"ok\":1}\n".to_vec()), Some(b"{\"ok\":1}\n".to_vec()));
    }

    #[test]
    fn new_listener_skips_across_chunks_without_newline() {
        let mut b = buf();
        b.push(b"head ".to_vec());
        b.discard_partial();
        assert_eq!(b.push(b"middle ".to_vec()), None);
        assert_eq!(b.push(b"end\nnext\n".to_vec()), Some(b"next\n".to_vec()));
    }

    #[test]
    fn new_listener_at_a_line_boundary_skips_nothing() {
        let mut b = buf();
        b.push(b"whole\n".to_vec());
        b.discard_partial();
        assert_eq!(b.push(b"fresh\n".to_vec()), Some(b"fresh\n".to_vec()));
    }

    #[test]
    fn overlong_line_is_dropped_and_resynchronizes_at_the_next_newline() {
        let mut b = LineBuffer::new(16);
        assert_eq!(b.push(vec![b'x'; 10]), None);
        assert_eq!(b.push(vec![b'x'; 10]), None); // 20 > 16: 버린다
        assert_eq!(b.push(b"tail\nok\n".to_vec()), Some(b"ok\n".to_vec()));
        assert_eq!(b.finish(), (0, 1));
    }

    #[test]
    fn newline_only_search_looks_at_the_new_chunk() {
        // 큰 프레임을 작은 조각으로 받아도 조각마다 꼬리 전체를 다시 훑지 않는다: 결과만 확인한다.
        let mut b = buf();
        for _ in 0..512 {
            assert_eq!(b.push(vec![b'a'; 2048]), None);
        }
        let mut last = vec![b'b'; 100];
        last.push(b'\n');
        let line = b.push(last).expect("line");
        assert_eq!(line.len(), 512 * 2048 + 101);
    }

    // ----- Credit -----

    #[tokio::test]
    async fn credit_allows_until_the_window_is_exceeded_then_waits_for_ack() {
        let credit = Arc::new(Credit::new(100));
        credit.acquire(60).await.expect("first");
        credit.acquire(60).await.expect("second: outstanding 60 <= 100");
        assert_eq!(credit.outstanding(), 120);
        // 120 > 100: 다음 송신은 확인을 기다린다.
        assert!(timeout(Duration::from_millis(50), credit.acquire(1)).await.is_err());
        let waiter = {
            let credit = credit.clone();
            tokio::spawn(async move { credit.acquire(1).await })
        };
        tokio::task::yield_now().await;
        credit.ack(30); // 90 <= 100
        assert_eq!(
            timeout(Duration::from_secs(1), waiter).await.expect("woken").expect("join"),
            Ok(())
        );
    }

    #[tokio::test]
    async fn credit_ack_never_exceeds_what_was_sent() {
        let credit = Credit::new(10);
        credit.acquire(5).await.expect("send");
        credit.ack(1_000_000);
        assert_eq!(credit.outstanding(), 0);
        credit.acquire(100).await.expect("an oversized batch passes at zero outstanding");
        assert_eq!(credit.outstanding(), 100);
    }

    #[tokio::test]
    async fn closing_credit_releases_waiters_with_an_error() {
        let credit = Arc::new(Credit::new(0));
        credit.acquire(10).await.expect("first passes");
        let waiter = {
            let credit = credit.clone();
            tokio::spawn(async move { credit.acquire(1).await })
        };
        tokio::task::yield_now().await;
        credit.close();
        assert_eq!(
            timeout(Duration::from_secs(1), waiter).await.expect("woken").expect("join"),
            Err(CreditClosed)
        );
    }

    // ----- Relay -----

    #[derive(Default)]
    struct FakeSink {
        bytes: Mutex<Vec<Vec<u8>>>,
        states: Mutex<Vec<EngineState>>,
        closed: AtomicBool,
    }

    impl FakeSink {
        fn received(&self) -> Vec<u8> {
            locked(&self.bytes).iter().flatten().copied().collect()
        }
        fn messages(&self) -> usize {
            locked(&self.bytes).len()
        }
    }

    impl Sink for FakeSink {
        fn send_bytes(&self, bytes: Vec<u8>) -> Result<(), SinkClosed> {
            if self.closed.load(Ordering::SeqCst) {
                return Err(SinkClosed);
            }
            locked(&self.bytes).push(bytes);
            Ok(())
        }
        fn send_state(&self, state: &EngineState) -> Result<(), SinkClosed> {
            if self.closed.load(Ordering::SeqCst) {
                return Err(SinkClosed);
            }
            locked(&self.states).push(state.clone());
            Ok(())
        }
    }

    fn relay() -> Arc<Relay> {
        Arc::new(Relay::new(EngineState::Stopped))
    }

    #[tokio::test]
    async fn relay_forwards_only_complete_lines() {
        let relay = relay();
        let sink = Arc::new(FakeSink::default());
        let attach = relay.attach(sink.clone());
        assert_eq!(attach.epoch, 1);
        let mut stream = relay.open_stream();
        stream.push(b"{\"a\":1}\n{\"b\"".to_vec()).await;
        assert_eq!(sink.received(), b"{\"a\":1}\n");
        stream.push(b":2}\n".to_vec()).await;
        assert_eq!(sink.received(), b"{\"a\":1}\n{\"b\":2}\n");
        let stats = stream.finish();
        assert_eq!(stats.forwarded_bytes, 16);
        assert_eq!(stats.dropped_tail_bytes, 0);
    }

    #[tokio::test]
    async fn relay_drops_the_tail_of_an_engine_generation_that_ended() {
        let relay = relay();
        let sink = Arc::new(FakeSink::default());
        relay.attach(sink.clone());
        let mut old = relay.open_stream();
        old.push(b"{\"id\":\"1\",\"resu".to_vec()).await;
        assert_eq!(old.finish().dropped_tail_bytes, 15);
        let mut new = relay.open_stream();
        new.push(b"{\"id\":\"2\"}\n".to_vec()).await;
        assert_eq!(sink.received(), b"{\"id\":\"2\"}\n");
    }

    #[tokio::test]
    async fn relay_drops_complete_lines_while_nothing_is_attached() {
        let relay = relay();
        let mut stream = relay.open_stream();
        stream.push(b"lost\n".to_vec()).await;
        let sink = Arc::new(FakeSink::default());
        relay.attach(sink.clone());
        stream.push(b"kept\n".to_vec()).await;
        assert_eq!(sink.received(), b"kept\n");
        assert_eq!(stream.finish().dropped_bytes, 5);
    }

    #[tokio::test]
    async fn attach_assigns_increasing_epochs_and_cuts_the_old_listener() {
        let relay = relay();
        let first = Arc::new(FakeSink::default());
        let second = Arc::new(FakeSink::default());
        assert_eq!(relay.attach(first.clone()).epoch, 1);
        let mut stream = relay.open_stream();
        stream.push(b"one\n".to_vec()).await;
        assert_eq!(relay.attach(second.clone()).epoch, 2);
        stream.push(b"two\n".to_vec()).await;
        assert_eq!(first.received(), b"one\n");
        assert_eq!(second.received(), b"two\n");
    }

    #[tokio::test]
    async fn page_reload_in_the_middle_of_a_frame_discards_that_frame() {
        let relay = relay();
        let first = Arc::new(FakeSink::default());
        let second = Arc::new(FakeSink::default());
        relay.attach(first.clone());
        let mut stream = relay.open_stream();
        stream.push(b"{\"id\":\"1\",\"res".to_vec()).await;
        relay.attach(second.clone());
        stream.push(b"ult\":1}\n{\"id\":\"2\"}\n".to_vec()).await;
        assert_eq!(first.received(), b"");
        assert_eq!(second.received(), b"{\"id\":\"2\"}\n");
    }

    #[tokio::test]
    async fn stale_epoch_is_rejected_for_writes_acks_and_detach() {
        let relay = relay();
        let first = Arc::new(FakeSink::default());
        relay.attach(first);
        relay.attach(Arc::new(FakeSink::default()));
        assert_eq!(relay.check_epoch(1), Err(CommandError::EpochStale));
        assert_eq!(relay.check_epoch(0), Err(CommandError::EpochStale));
        assert_eq!(relay.check_epoch(2), Ok(()));
        assert!(!relay.ack(1, 10));
        assert!(!relay.detach(1));
        assert_eq!(relay.check_epoch(2), Ok(()));
        assert!(relay.detach(2));
        assert_eq!(relay.check_epoch(2), Err(CommandError::EpochStale));
    }

    #[tokio::test]
    async fn credit_backpressure_stalls_the_reader_until_ack() {
        let relay = relay();
        let sink = Arc::new(FakeSink::default());
        let attach = relay.attach(sink.clone());
        let window = CREDIT_WINDOW_BYTES as usize;
        let line = |n: usize| {
            let mut v = vec![b'x'; n - 1];
            v.push(b'\n');
            v
        };
        let reader = {
            let relay = relay.clone();
            tokio::spawn(async move {
                let mut stream = relay.open_stream();
                // 창을 넘길 때까지 보내고, 그다음 묶음에서 멈춘다.
                stream.push(line(window)).await;
                stream.push(line(window)).await; // outstanding == window: 통과
                stream.push(line(1024)).await; // outstanding == 2*window: 대기
                stream.finish()
            })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(sink.messages(), 2, "third batch must wait for credit");
        assert!(!reader.is_finished());
        relay.ack(attach.epoch, ACK_STEP_BYTES * 2);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(sink.messages(), 2, "still above the window");
        relay.ack(attach.epoch, window as u64);
        let stats = timeout(Duration::from_secs(2), reader).await.expect("released").expect("join");
        assert_eq!(sink.messages(), 3);
        assert_eq!(stats.dropped_bytes, 0);
    }

    #[tokio::test]
    async fn reattach_releases_a_stalled_reader_and_drops_its_batch() {
        let relay = relay();
        let first = Arc::new(FakeSink::default());
        relay.attach(first.clone());
        let window = CREDIT_WINDOW_BYTES as usize;
        let reader = {
            let relay = relay.clone();
            tokio::spawn(async move {
                let mut stream = relay.open_stream();
                let mut big = vec![b'x'; window * 2];
                big.push(b'\n');
                stream.push(big).await; // 한 묶음이 창의 두 배: 통과
                stream.push(b"stalled\n".to_vec()).await; // 대기
                stream.finish()
            })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(first.messages(), 1);
        let second = Arc::new(FakeSink::default());
        relay.attach(second.clone());
        let stats = timeout(Duration::from_secs(2), reader).await.expect("released").expect("join");
        assert_eq!(stats.dropped_bytes, 8);
        assert_eq!(second.messages(), 0);
    }

    #[tokio::test]
    async fn drain_releases_a_stalled_reader_and_later_bytes_are_dropped() {
        let relay = relay();
        let sink = Arc::new(FakeSink::default());
        relay.attach(sink.clone());
        let window = CREDIT_WINDOW_BYTES as usize;
        let reader = {
            let relay = relay.clone();
            tokio::spawn(async move {
                let mut stream = relay.open_stream();
                let mut big = vec![b'x'; window * 2];
                big.push(b'\n');
                stream.push(big).await;
                stream.push(b"stalled\n".to_vec()).await;
                stream.push(b"after\n".to_vec()).await;
                stream.finish()
            })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        relay.begin_drain();
        let stats = timeout(Duration::from_secs(2), reader).await.expect("released").expect("join");
        assert_eq!(stats.dropped_bytes, 8 + 6);
        // 종료 중에 붙은 페이지도 바이트를 받지 못한다.
        let late = Arc::new(FakeSink::default());
        relay.attach(late.clone());
        let mut stream = relay.open_stream();
        stream.push(b"x\n".to_vec()).await;
        assert_eq!(late.messages(), 0);
    }

    #[tokio::test]
    async fn closed_sink_detaches_itself() {
        let relay = relay();
        let sink = Arc::new(FakeSink::default());
        let attach = relay.attach(sink.clone());
        sink.closed.store(true, Ordering::SeqCst);
        let mut stream = relay.open_stream();
        stream.push(b"a\n".to_vec()).await;
        assert_eq!(relay.check_epoch(attach.epoch), Err(CommandError::EpochStale));
    }

    #[tokio::test]
    async fn state_changes_reach_the_attached_page_and_attach_returns_the_latest() {
        let relay = relay();
        relay.set_state(EngineState::Stopping);
        let sink = Arc::new(FakeSink::default());
        let attach = relay.attach(sink.clone());
        assert_eq!(attach.state, EngineState::Stopping);
        relay.set_state(EngineState::Stopped);
        assert_eq!(*locked(&sink.states), vec![EngineState::Stopped]);
    }

    // ----- 엔진 stdin 쓰기 -----

    /// 쓰기를 기록하고, `gate`가 열릴 때까지 막을 수 있는 가짜 stdin.
    struct GatedStdin {
        written: Arc<Mutex<Vec<u8>>>,
        gate: Arc<(Mutex<bool>, Condvar)>,
        closed: Arc<AtomicBool>,
    }

    impl StdinSink for GatedStdin {
        fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            let (lock, cv) = &*self.gate;
            let mut open = locked(lock);
            while !*open {
                open = cv.wait(open).unwrap_or_else(|e| e.into_inner());
            }
            locked(&self.written).extend_from_slice(bytes);
            Ok(())
        }
    }

    impl Drop for GatedStdin {
        fn drop(&mut self) {
            self.closed.store(true, Ordering::SeqCst);
        }
    }

    struct Pipe {
        handle: PipeHandle,
        written: Arc<Mutex<Vec<u8>>>,
        gate: Arc<(Mutex<bool>, Condvar)>,
        closed: Arc<AtomicBool>,
    }

    impl Pipe {
        fn new(open: bool, capacity: usize) -> Self {
            let written = Arc::new(Mutex::new(Vec::new()));
            let gate = Arc::new((Mutex::new(open), Condvar::new()));
            let closed = Arc::new(AtomicBool::new(false));
            let handle = spawn_pipe_writer(
                Box::new(GatedStdin {
                    written: written.clone(),
                    gate: gate.clone(),
                    closed: closed.clone(),
                }),
                capacity,
            )
            .expect("thread");
            Self {
                handle,
                written,
                gate,
                closed,
            }
        }
        fn open_gate(&self) {
            *locked(&self.gate.0) = true;
            self.gate.1.notify_all();
        }
        fn written(&self) -> Vec<u8> {
            locked(&self.written).clone()
        }
        async fn wait_closed(&self) {
            for _ in 0..200 {
                if self.closed.load(Ordering::SeqCst) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            panic!("stdin was not closed");
        }
    }

    #[tokio::test]
    async fn pipe_writes_frames_in_order_and_closes_stdin_after_the_queue() {
        let pipe = Pipe::new(true, 4);
        pipe.handle.write_frame(b"a\n".to_vec()).await.expect("a");
        pipe.handle.write_frame(b"b\n".to_vec()).await.expect("b");
        pipe.handle.close_write().await.expect("close");
        pipe.wait_closed().await;
        assert_eq!(pipe.written(), b"a\nb\n");
        assert_eq!(pipe.handle.write_frame(b"c\n".to_vec()).await, Err(PipeClosed));
    }

    #[tokio::test]
    async fn shell_frame_first_terminates_a_broken_line() {
        let pipe = Pipe::new(true, 4);
        pipe.handle.write_frame(b"{\"half\":".to_vec()).await.expect("half");
        pipe.handle
            .write_shell_frame(b"{\"shutdown\":1}\n".to_vec())
            .await
            .expect("shell");
        pipe.handle.close_write().await.expect("close");
        pipe.wait_closed().await;
        assert_eq!(pipe.written(), b"{\"half\":\n{\"shutdown\":1}\n");
    }

    #[tokio::test]
    async fn shell_frame_does_not_add_a_newline_at_a_boundary() {
        let pipe = Pipe::new(true, 4);
        pipe.handle.write_frame(b"x\n".to_vec()).await.expect("x");
        pipe.handle.write_shell_frame(b"y\n".to_vec()).await.expect("y");
        pipe.handle.close_write().await.expect("close");
        pipe.wait_closed().await;
        assert_eq!(pipe.written(), b"x\ny\n");
    }

    /// 조건 2: 막힌 쓰기가 다른 비동기 작업을 막지 않고, 대기열이 차면 호출자는 기다리지만 런타임은 돈다.
    #[tokio::test]
    async fn a_blocked_stdin_write_does_not_block_other_tasks() {
        let pipe = Pipe::new(false, 2);
        pipe.handle.write_frame(b"1\n".to_vec()).await.expect("1: 스레드가 쥔다");
        // 스레드가 첫 쓰기에서 막힌 채로 대기열(2)을 채운다.
        pipe.handle.write_frame(b"2\n".to_vec()).await.expect("2");
        pipe.handle.write_frame(b"3\n".to_vec()).await.expect("3");
        let blocked = {
            let handle = pipe.handle.clone();
            tokio::spawn(async move { handle.write_frame(b"4\n".to_vec()).await })
        };
        // 대기열이 찬 동안에도 런타임은 다른 일을 한다.
        let started = std::time::Instant::now();
        for _ in 0..10 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(!blocked.is_finished(), "queue is full: the 4th write waits");
        assert_eq!(pipe.written(), b"");
        pipe.open_gate();
        timeout(Duration::from_secs(2), blocked)
            .await
            .expect("released")
            .expect("join")
            .expect("written");
        pipe.handle.close_write().await.expect("close");
        pipe.wait_closed().await;
        assert_eq!(pipe.written(), b"1\n2\n3\n4\n");
    }

    #[tokio::test]
    async fn dropping_every_handle_closes_stdin() {
        let pipe = Pipe::new(true, 2);
        let Pipe { handle, closed, .. } = pipe;
        drop(handle);
        for _ in 0..200 {
            if closed.load(Ordering::SeqCst) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("stdin was not closed");
    }
}
