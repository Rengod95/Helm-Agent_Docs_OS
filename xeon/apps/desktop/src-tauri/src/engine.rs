//! 엔진 사이드카 수명 관리 (L4.desktop.spec 4.1 E1~E11, 4.3, 4.4).
//!
//! - spawn은 `Launcher::launch` 한 곳에서만 한다(E1). 운영 구현은 `TauriLauncher`다.
//! - 쓰기는 전용 스레드가 `CommandChild`를 쥐고 한다(relay.rs). 종료 경로는 pid로 프로세스 그룹에
//!   신호를 보내므로 막힌 쓰기 뒤에 줄을 서지 않는다.
//! - 종료 순서: `host.shutdown` 요청 쓰기, stdin 닫기(EOF), 시한까지 대기, 그다음 그룹 SIGKILL(S1).
//!   EOF 처리 기회를 주기 전에 그룹 SIGKILL을 하지 않는다.
//! - 재기동은 10분 창 안의 횟수 상한과 백오프를 따른다(4.4).

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::runtime::Handle;
use tokio::sync::{mpsc, watch, Notify};
use tokio::time::{timeout, timeout_at, Instant};

use crate::applog::AppLog;
use crate::relay::{
    spawn_pipe_writer, CommandError, PipeHandle, Relay, StdinSink, WRITE_QUEUE_FRAMES,
};
use crate::time::{now_ms, rfc3339_utc};

/// `xeon/apps/desktop/sidecar.json`의 `name`과 같아야 한다(test/sidecar-config.test.ts가 대조한다).
pub const SIDECAR_NAME: &str = "xeon";
/// `sidecar.json`의 `args`와 같아야 한다.
pub const SIDECAR_ARGS: [&str; 2] = ["host", "--stdio"];

/// 엔진 stderr 줄 길이 상한(E10).
const STDERR_LINE_MAX: usize = 8 * 1024;
/// 그룹 SIGKILL 뒤 프로세스 종료 확인을 기다리는 시간.
const KILL_SETTLE: Duration = Duration::from_secs(2);

// ---------------------------------------------------------------------------------------------
// 공개 상태 (ipc.ts의 EngineStateSchema와 같은 모양)

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineSource {
    Sidecar,
    /// M3 서비스 모드.
    #[allow(dead_code)]
    Service,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EngineExit {
    pub code: Option<i32>,
    pub signal: Option<i32>,
    pub at: String,
}

impl EngineExit {
    fn new(code: Option<i32>, signal: Option<i32>) -> Self {
        Self {
            code,
            signal,
            at: rfc3339_utc(now_ms()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EngineState {
    Starting {
        source: EngineSource,
        attempt: u32,
    },
    Running {
        source: EngineSource,
        pid: Option<u32>,
    },
    Restarting {
        attempt: u32,
        retry_at: String,
        last_exit: EngineExit,
    },
    Stopping,
    Failed {
        attempts: u32,
        last_exit: EngineExit,
    },
    Stopped,
}

// ---------------------------------------------------------------------------------------------
// 설정

/// 셸이 읽는 `l4.desktop.engine.*` 값. 설정 저장소(DESK.4 이후)가 정해질 때까지 기본값을 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EngineConfig {
    /// 종료 요청 뒤 엔진이 끝나기를 기다리는 시간(`shutdownGraceMs`).
    pub shutdown_grace: Duration,
    /// 10분 창 안의 자동 재기동 횟수 상한(`restartLimit`). 0이면 자동 재기동을 끈다.
    pub restart_limit: u32,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            shutdown_grace: Duration::from_millis(7000),
            restart_limit: 3,
        }
    }
}

impl EngineConfig {
    /// 설정 파일에서 읽은 값을 검사해 쓴다. 없거나 범위 밖이면 그 값만 기본값으로 둔다
    /// (`F.wire-settings.spec` 4.8의 파일 값 규칙과 같다).
    // 설정 저장소(DESK.4 이후)가 연결되면 main.rs가 부른다.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_values(shutdown_grace_ms: Option<i64>, restart_limit: Option<i64>) -> Self {
        let default = Self::default();
        let grace = shutdown_grace_ms
            .filter(|ms| (1000..=180_000).contains(ms))
            .and_then(|ms| u64::try_from(ms).ok())
            .map_or(default.shutdown_grace, Duration::from_millis);
        let limit = restart_limit
            .filter(|n| (0..=10).contains(n))
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(default.restart_limit);
        Self {
            shutdown_grace: grace,
            restart_limit: limit,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 재기동 정책

const RESTART_WINDOW: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestartDecision {
    Restart { attempt: u32, delay: Duration },
    GiveUp { attempts: u32 },
}

/// 10분 창 안의 재기동 횟수를 센다. 1번째는 즉시, 이후 1초, 2초, 4초, 8초 상한이다.
/// 10분 동안 재기동이 없으면 창에서 빠져 횟수가 0으로 돌아간다.
#[derive(Debug)]
pub struct RestartPolicy {
    limit: u32,
    recent: VecDeque<Instant>,
}

impl RestartPolicy {
    pub fn new(limit: u32) -> Self {
        Self {
            limit,
            recent: VecDeque::new(),
        }
    }

    pub fn on_exit(&mut self, now: Instant) -> RestartDecision {
        while let Some(first) = self.recent.front() {
            if now.saturating_duration_since(*first) > RESTART_WINDOW {
                self.recent.pop_front();
            } else {
                break;
            }
        }
        let done = u32::try_from(self.recent.len()).unwrap_or(u32::MAX);
        if done >= self.limit {
            return RestartDecision::GiveUp { attempts: done };
        }
        self.recent.push_back(now);
        let attempt = done + 1;
        RestartDecision::Restart {
            attempt,
            delay: backoff(attempt),
        }
    }

    /// 수동 재기동. 횟수를 0으로 되돌린다.
    pub fn reset(&mut self) {
        self.recent.clear();
    }
}

fn backoff(attempt: u32) -> Duration {
    match attempt {
        0 | 1 => Duration::ZERO,
        2 => Duration::from_secs(1),
        3 => Duration::from_secs(2),
        4 => Duration::from_secs(4),
        _ => Duration::from_secs(8),
    }
}

// ---------------------------------------------------------------------------------------------
// 환경과 프로세스 그룹

/// E7: 엔진 환경에서 `BUN_OPTIONS`만 지우고 나머지는 상속한다.
pub fn engine_env<I>(vars: I) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    vars.into_iter()
        .filter(|(key, _)| key != "BUN_OPTIONS")
        .collect()
}

/// 프로세스 그룹 전체에 SIGKILL(Unix) 또는 프로세스 트리 종료(Windows)를 보낸다.
/// 그룹에 남은 프로세스가 없으면 성공이다.
#[cfg(unix)]
pub fn kill_process_group(pid: u32) -> io::Result<()> {
    let pgid = libc::pid_t::try_from(pid)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "pid out of range"))?;
    // 0은 호출자 자신의 그룹, 1은 init이다. 어느 쪽도 엔진 그룹이 아니다.
    if pgid <= 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing to signal pgid <= 1",
        ));
    }
    // SAFETY: killpg는 정수 두 개를 받는 시스템 호출이고 메모리를 건드리지 않는다.
    if unsafe { libc::killpg(pgid, libc::SIGKILL) } == 0 {
        return Ok(());
    }
    let err = io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(err)
    }
}

/// Windows는 job 핸들을 `CommandChild`가 쥐고 있어 쓰기 스레드가 소유한 뒤에는 쓸 수 없다.
/// `taskkill /T`로 트리를 끝낸다. kill-on-close job object는 M3 결정 사항이다(L4.desktop.spec 10 미결 7).
#[cfg(windows)]
pub fn kill_process_group(pid: u32) -> io::Result<()> {
    if pid <= 1 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing to signal pid <= 1",
        ));
    }
    let status = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()?;
    // 종료 코드 128: 이미 없는 프로세스.
    if status.success() || status.code() == Some(128) {
        Ok(())
    } else {
        Err(io::Error::other(format!("taskkill exited with {status}")))
    }
}

// ---------------------------------------------------------------------------------------------
// stderr 줄 나누기 (E10)

/// stderr 바이트를 줄로 나눈다. 줄은 8 KiB에서 자르고 나머지는 버린다.
#[derive(Default)]
pub struct StderrSplitter {
    current: Vec<u8>,
    truncated: bool,
}

impl StderrSplitter {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        let mut lines = Vec::new();
        let mut rest = chunk;
        while let Some(at) = memchr::memchr(b'\n', rest) {
            self.append(&rest[..at]);
            lines.push(self.take_line());
            rest = &rest[at + 1..];
        }
        self.append(rest);
        lines
    }

    pub fn finish(&mut self) -> Option<String> {
        if self.current.is_empty() && !self.truncated {
            None
        } else {
            Some(self.take_line())
        }
    }

    fn append(&mut self, bytes: &[u8]) {
        let room = STDERR_LINE_MAX.saturating_sub(self.current.len());
        if bytes.len() > room {
            self.truncated = true;
        }
        self.current.extend_from_slice(&bytes[..bytes.len().min(room)]);
    }

    fn take_line(&mut self) -> String {
        let bytes = std::mem::take(&mut self.current);
        self.truncated = false;
        String::from_utf8_lossy(&bytes).trim_end_matches('\r').to_string()
    }
}

// ---------------------------------------------------------------------------------------------
// 실행 추상화

pub enum EngineEvent {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
    Terminated { code: Option<i32>, signal: Option<i32> },
    Error(String),
}

pub struct Launched {
    pub pid: u32,
    pub events: mpsc::Receiver<EngineEvent>,
    pub stdin: Box<dyn StdinSink>,
}

#[derive(Debug)]
pub struct LaunchError(pub String);

/// 엔진 프로세스를 띄우고 그룹을 끝내는 수단. 운영은 `TauriLauncher`, 시험은 가짜다.
pub trait Launcher: Send + Sync + 'static {
    fn launch(&self) -> Result<Launched, LaunchError>;
    fn kill_group(&self, pid: u32) -> io::Result<()>;
}

// ---------------------------------------------------------------------------------------------
// 감독자

struct Live {
    generation: u64,
    pid: u32,
    pipe: PipeHandle,
}

#[derive(Default)]
struct Shared {
    generation: u64,
    live: Option<Live>,
    stop_requested: bool,
    shutdown_started: bool,
    exit_allowed: bool,
    failed: bool,
}

struct Inner<L: Launcher> {
    launcher: L,
    relay: Arc<Relay>,
    config: EngineConfig,
    log: Arc<AppLog>,
    runtime: Handle,
    shared: Mutex<Shared>,
    stop_wake: Notify,
    restart_wake: Notify,
    /// 마지막으로 끝난 엔진 세대.
    exited: watch::Sender<u64>,
    /// 실행 루프가 끝났다.
    stopped: watch::Sender<bool>,
}

fn shared<L: Launcher>(inner: &Inner<L>) -> MutexGuard<'_, Shared> {
    inner.shared.lock().unwrap_or_else(|e| e.into_inner())
}

/// `RunEvent::ExitRequested`에서 할 일.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitAction {
    /// 그대로 종료한다.
    Allow,
    /// 종료를 미루고 정상 종료 순서를 시작한다.
    PreventAndShutdown,
    /// 종료를 미룬다. 정상 종료 순서가 이미 진행 중이다.
    Prevent,
}

pub struct Supervisor<L: Launcher> {
    inner: Arc<Inner<L>>,
}

impl<L: Launcher> Clone for Supervisor<L> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

pub type AppSupervisor = Supervisor<TauriLauncher>;

impl<L: Launcher> Supervisor<L> {
    pub fn new(
        launcher: L,
        relay: Arc<Relay>,
        config: EngineConfig,
        log: Arc<AppLog>,
        runtime: Handle,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                launcher,
                relay,
                config,
                log,
                runtime,
                shared: Mutex::new(Shared::default()),
                stop_wake: Notify::new(),
                restart_wake: Notify::new(),
                exited: watch::channel(0).0,
                stopped: watch::channel(false).0,
            }),
        }
    }

    /// 실행 루프를 띄운다. 앱당 한 번 부른다.
    pub fn start(&self) {
        let inner = self.inner.clone();
        self.inner.runtime.spawn(run_loop(inner));
    }

    /// WebView의 stdin 쓰기. 종료 중이면 거부하고, 락은 손잡이를 복제하는 동안만 쥔다.
    pub async fn write(&self, bytes: Vec<u8>) -> Result<(), CommandError> {
        let pipe = {
            let state = shared(&self.inner);
            if state.stop_requested {
                return Err(CommandError::EngineStopping);
            }
            state.live.as_ref().map(|live| live.pipe.clone())
        };
        let pipe = pipe.ok_or(CommandError::EngineNotRunning)?;
        pipe.write_frame(bytes)
            .await
            .map_err(|_| CommandError::EngineNotRunning)
    }

    /// `failed` 상태에서 사용자가 고른 수동 재기동.
    pub fn restart_manually(&self) -> Result<(), CommandError> {
        {
            let state = shared(&self.inner);
            if !state.failed || state.stop_requested {
                return Err(CommandError::NotFailed);
            }
        }
        self.inner.restart_wake.notify_one();
        Ok(())
    }

    pub fn on_exit_requested(&self) -> ExitAction {
        let mut state = shared(&self.inner);
        if state.exit_allowed {
            return ExitAction::Allow;
        }
        if state.live.is_none() {
            // 살아 있는 엔진이 없다. 대기 중인 재기동도 취소한다.
            state.stop_requested = true;
            drop(state);
            self.inner.stop_wake.notify_one();
            return ExitAction::Allow;
        }
        if state.shutdown_started {
            ExitAction::Prevent
        } else {
            state.shutdown_started = true;
            ExitAction::PreventAndShutdown
        }
    }

    /// 두 번째 `ExitRequested`를 막지 않게 한다.
    pub fn allow_exit(&self) {
        shared(&self.inner).exit_allowed = true;
    }

    /// 정상 종료 순서 (L4.desktop.spec 4.3 2~5단계).
    pub async fn shutdown(&self) {
        let inner = &self.inner;
        let live = {
            let mut state = shared(inner);
            state.stop_requested = true;
            state.live.as_ref().map(|l| (l.generation, l.pid, l.pipe.clone()))
        };
        inner.relay.begin_drain();
        inner.stop_wake.notify_one();
        if let Some((generation, pid, pipe)) = live {
            inner.relay.set_state(EngineState::Stopping);
            self.stop_engine(generation, pid, &pipe).await;
        }
        let mut stopped = inner.stopped.subscribe();
        if timeout(KILL_SETTLE, stopped.wait_for(|done| *done)).await.is_err() {
            inner.log.line("shutdown: run loop did not report stopped in time");
        }
    }

    async fn stop_engine(&self, generation: u64, pid: u32, pipe: &PipeHandle) {
        let inner = &self.inner;
        let deadline = Instant::now() + inner.config.shutdown_grace;
        let mut exited = inner.exited.subscribe();

        // 2~3. host.shutdown 요청 한 줄을 쓰고 stdin을 닫는다. 쓰기가 막혀 있으면 시한이 끊는다.
        let request = shutdown_request(generation);
        if timeout_at(deadline, pipe.write_shell_frame(request)).await.is_err() {
            inner.log.line("shutdown: stdin write is blocked, skipping to EOF wait");
        }
        if timeout_at(deadline, pipe.close_write()).await.is_err() {
            inner.log.line("shutdown: could not queue stdin close");
        }

        // 4. 엔진이 끝나기를 시한까지 기다린다.
        let finished = timeout_at(deadline, exited.wait_for(|last| *last >= generation))
            .await
            .is_ok();
        if !finished {
            inner.log.line("shutdown: grace period expired, killing the process group");
        }

        // 5. 시한 안에 끝났더라도 그룹에 남은 손자를 정리한다. 남은 것이 없으면 아무 일도 없다.
        if let Err(error) = inner.launcher.kill_group(pid) {
            inner.log.line(&format!("shutdown: kill_group failed: {error}"));
        }
        if !finished && timeout(KILL_SETTLE, exited.wait_for(|last| *last >= generation)).await.is_err() {
            inner.log.line("shutdown: engine termination was not observed after SIGKILL");
        }
    }

    /// 앱이 끝나는 마지막 순간의 방어. 남은 그룹이 있으면 SIGKILL을 보낸다(동기).
    pub fn kill_remaining(&self) {
        let pid = shared(&self.inner).live.as_ref().map(|l| l.pid);
        if let Some(pid) = pid {
            if let Err(error) = self.inner.launcher.kill_group(pid) {
                self.inner.log.line(&format!("exit: kill_group failed: {error}"));
            }
        }
    }
}

/// 셸이 stdin에 쓰는 종료 요청 한 줄. id는 `shell:shutdown:<n>` 꼴이다.
fn shutdown_request(generation: u64) -> Vec<u8> {
    format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":\"shell:shutdown:{generation}\",\"method\":\"host.shutdown\",\"params\":{{\"reason\":\"client_exit\"}}}}\n"
    )
    .into_bytes()
}

async fn run_loop<L: Launcher>(inner: Arc<Inner<L>>) {
    let mut policy = RestartPolicy::new(inner.config.restart_limit);
    let mut attempt: u32 = 0;
    loop {
        if shared(&inner).stop_requested {
            break;
        }
        inner.relay.set_state(EngineState::Starting {
            source: EngineSource::Sidecar,
            attempt,
        });
        let launched = match inner.launcher.launch() {
            Ok(launched) => launched,
            Err(LaunchError(message)) => {
                // 바이너리 없음, 실행 권한 없음, triple 불일치는 되풀이해도 같다. 재기동하지 않는다(spec 5).
                inner.log.line(&format!("launch failed: {message}"));
                if !fail_and_wait(&inner, attempt, EngineExit::new(None, None)).await {
                    break;
                }
                policy.reset();
                attempt = 0;
                continue;
            }
        };
        let pid = launched.pid;
        let pipe = match spawn_pipe_writer(launched.stdin, WRITE_QUEUE_FRAMES) {
            Ok(pipe) => pipe,
            Err(error) => {
                inner.log.line(&format!("stdin writer thread failed: {error}"));
                if let Err(kill) = inner.launcher.kill_group(pid) {
                    inner.log.line(&format!("kill_group failed: {kill}"));
                }
                if !fail_and_wait(&inner, attempt, EngineExit::new(None, None)).await {
                    break;
                }
                policy.reset();
                attempt = 0;
                continue;
            }
        };
        let generation = {
            let mut state = shared(&inner);
            state.generation += 1;
            state.failed = false;
            let generation = state.generation;
            state.live = Some(Live {
                generation,
                pid,
                pipe,
            });
            generation
        };
        inner.log.line(&format!("engine[{generation}] started pid={pid}"));
        inner.relay.set_state(EngineState::Running {
            source: EngineSource::Sidecar,
            pid: Some(pid),
        });

        let exit = pump(&inner, generation, launched.events).await;

        shared(&inner).live = None;
        inner.exited.send_replace(generation);
        inner.log.line(&format!(
            "engine[{generation}] exited code={:?} signal={:?}",
            exit.code, exit.signal
        ));
        if shared(&inner).stop_requested {
            break;
        }
        match policy.on_exit(Instant::now()) {
            RestartDecision::Restart { attempt: next, delay } => {
                attempt = next;
                let retry_at = rfc3339_utc(now_ms() + u64::try_from(delay.as_millis()).unwrap_or(0));
                inner.relay.set_state(EngineState::Restarting {
                    attempt: next,
                    retry_at,
                    last_exit: exit,
                });
                if !delay.is_zero() {
                    tokio::select! {
                        () = tokio::time::sleep(delay) => {}
                        () = inner.stop_wake.notified() => {}
                    }
                }
            }
            RestartDecision::GiveUp { attempts } => {
                if !fail_and_wait(&inner, attempts, exit).await {
                    break;
                }
                policy.reset();
                attempt = 0;
            }
        }
    }
    inner.relay.set_state(EngineState::Stopped);
    inner.stopped.send_replace(true);
}

/// `failed`로 두고 수동 재기동 또는 종료를 기다린다. 수동 재기동이면 참이다.
async fn fail_and_wait<L: Launcher>(inner: &Arc<Inner<L>>, attempts: u32, last_exit: EngineExit) -> bool {
    {
        let mut state = shared(inner);
        if state.stop_requested {
            return false;
        }
        state.failed = true;
    }
    inner.relay.set_state(EngineState::Failed {
        attempts,
        last_exit,
    });
    tokio::select! {
        () = inner.restart_wake.notified() => !shared(inner).stop_requested,
        () = inner.stop_wake.notified() => false,
    }
}

/// 엔진 이벤트를 소비한다. stdout은 세대 전용 스트림으로, stderr는 줄 단위 로그로 보낸다.
async fn pump<L: Launcher>(
    inner: &Arc<Inner<L>>,
    generation: u64,
    mut events: mpsc::Receiver<EngineEvent>,
) -> EngineExit {
    let mut stream = inner.relay.open_stream();
    let mut stderr = StderrSplitter::default();
    let mut exit = None;
    while let Some(event) = events.recv().await {
        match event {
            EngineEvent::Stdout(bytes) => stream.push(bytes).await,
            EngineEvent::Stderr(bytes) => {
                for line in stderr.push(&bytes) {
                    inner.log.line(&format!("engine[{generation}] stderr: {line}"));
                }
            }
            EngineEvent::Terminated { code, signal } => {
                exit = Some(EngineExit::new(code, signal));
                break;
            }
            EngineEvent::Error(message) => {
                inner.log.line(&format!("engine[{generation}] event error: {message}"));
            }
        }
    }
    if let Some(line) = stderr.finish() {
        inner.log.line(&format!("engine[{generation}] stderr: {line}"));
    }
    // E11: 프레임 내용은 남기지 않고 바이트 수만 남긴다.
    let stats = stream.finish();
    inner.log.line(&format!(
        "engine[{generation}] relay forwarded={}B dropped={}B dropped_tail={}B overflowed_lines={}",
        stats.forwarded_bytes, stats.dropped_bytes, stats.dropped_tail_bytes, stats.overflowed_lines
    ));
    exit.unwrap_or_else(|| EngineExit::new(None, None))
}

// ---------------------------------------------------------------------------------------------
// Tauri 구현

/// `CommandChild`를 감싼 stdin. 떨어뜨리면(drop) 파이프가 닫혀 EOF가 된다(플러그인은 drop에서 프로세스를 죽이지 않는다).
pub(crate) struct ChildStdin(pub(crate) CommandChild);

impl StdinSink for ChildStdin {
    fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.0.write(bytes).map_err(io::Error::other)
    }
}

/// 플러그인의 이벤트 채널을 용량 1의 채널로 한 번 더 거친다. 소비가 느리면 플러그인의 읽기 스레드까지 멈춘다.
pub(crate) fn forward_events(
    runtime: &Handle,
    mut rx: mpsc::Receiver<CommandEvent>,
) -> mpsc::Receiver<EngineEvent> {
    let (tx, events) = mpsc::channel(1);
    runtime.spawn(async move {
        while let Some(event) = rx.recv().await {
            let mapped = match event {
                CommandEvent::Stdout(bytes) => EngineEvent::Stdout(bytes),
                CommandEvent::Stderr(bytes) => EngineEvent::Stderr(bytes),
                CommandEvent::Terminated(payload) => EngineEvent::Terminated {
                    code: payload.code,
                    signal: payload.signal,
                },
                CommandEvent::Error(message) => EngineEvent::Error(message),
                _ => continue,
            };
            if tx.send(mapped).await.is_err() {
                break;
            }
        }
    });
    events
}

pub struct TauriLauncher {
    app: AppHandle,
    runtime: Handle,
}

impl TauriLauncher {
    pub fn new(app: AppHandle, runtime: Handle) -> Self {
        Self { app, runtime }
    }

    /// E6: 사용자 홈 디렉터리의 절대 경로.
    pub(crate) fn working_dir(&self) -> Result<PathBuf, LaunchError> {
        let home = self
            .app
            .path()
            .home_dir()
            .map_err(|e| LaunchError(format!("home directory is unknown: {e}")))?;
        if home.is_absolute() {
            Ok(home)
        } else {
            Err(LaunchError(format!("home directory is not absolute: {}", home.display())))
        }
    }

    #[cfg(debug_assertions)]
    pub(crate) fn dev_override() -> Option<(OsString, Vec<OsString>)> {
        let bin = std::env::var_os("XEON_DESKTOP_ENGINE_BIN").filter(|v| !v.is_empty())?;
        let args = std::env::var("XEON_DESKTOP_ENGINE_ARGS")
            .map(|text| text.split_whitespace().map(OsString::from).collect())
            .unwrap_or_default();
        Some((bin, args))
    }

    #[cfg(not(debug_assertions))]
    pub(crate) fn dev_override() -> Option<(OsString, Vec<OsString>)> {
        None
    }
}

impl Launcher for TauriLauncher {
    fn launch(&self) -> Result<Launched, LaunchError> {
        let cwd = self.working_dir()?;
        let shell = self.app.shell();
        let command = match Self::dev_override() {
            Some((bin, args)) => shell.command(bin).args(args),
            None => shell
                .sidecar(SIDECAR_NAME)
                .map_err(|e| LaunchError(format!("sidecar `{SIDECAR_NAME}` is not available: {e}")))?
                .args(SIDECAR_ARGS),
        };
        let (rx, child) = command
            .set_raw_out(true)
            .set_process_group(true)
            .current_dir(cwd)
            .env_clear()
            .envs(engine_env(std::env::vars_os()))
            .spawn()
            .map_err(|e| LaunchError(format!("spawn failed: {e}")))?;
        let pid = child.pid();
        let events = forward_events(&self.runtime, rx);
        Ok(Launched {
            pid,
            events,
            stdin: Box::new(ChildStdin(child)),
        })
    }

    fn kill_group(&self, pid: u32) -> io::Result<()> {
        kill_process_group(pid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::{Sink, SinkClosed};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Condvar;

    // ----- 순수 로직 -----

    #[test]
    fn engine_state_serializes_to_the_ipc_schema() {
        let exit = EngineExit {
            code: Some(1),
            signal: None,
            at: "2026-10-24T00:00:00.000Z".into(),
        };
        let cases = [
            (
                EngineState::Starting { source: EngineSource::Sidecar, attempt: 2 },
                r#"{"kind":"starting","source":"sidecar","attempt":2}"#,
            ),
            (
                EngineState::Running { source: EngineSource::Sidecar, pid: Some(42) },
                r#"{"kind":"running","source":"sidecar","pid":42}"#,
            ),
            (
                EngineState::Restarting {
                    attempt: 1,
                    retry_at: "2026-10-24T00:00:01.000Z".into(),
                    last_exit: exit.clone(),
                },
                r#"{"kind":"restarting","attempt":1,"retryAt":"2026-10-24T00:00:01.000Z","lastExit":{"code":1,"signal":null,"at":"2026-10-24T00:00:00.000Z"}}"#,
            ),
            (EngineState::Stopping, r#"{"kind":"stopping"}"#),
            (
                EngineState::Failed { attempts: 3, last_exit: exit },
                r#"{"kind":"failed","attempts":3,"lastExit":{"code":1,"signal":null,"at":"2026-10-24T00:00:00.000Z"}}"#,
            ),
            (EngineState::Stopped, r#"{"kind":"stopped"}"#),
        ];
        for (state, expected) in cases {
            assert_eq!(serde_json::to_string(&state).expect("json"), expected);
        }
    }

    #[test]
    fn restart_policy_backs_off_then_gives_up() {
        let mut policy = RestartPolicy::new(3);
        let t = Instant::now();
        assert_eq!(policy.on_exit(t), RestartDecision::Restart { attempt: 1, delay: Duration::ZERO });
        assert_eq!(policy.on_exit(t), RestartDecision::Restart { attempt: 2, delay: Duration::from_secs(1) });
        assert_eq!(policy.on_exit(t), RestartDecision::Restart { attempt: 3, delay: Duration::from_secs(2) });
        // D-05: restartLimit + 1번째 종료는 failed.
        assert_eq!(policy.on_exit(t), RestartDecision::GiveUp { attempts: 3 });
    }

    #[test]
    fn restart_policy_backoff_caps_at_eight_seconds() {
        let mut policy = RestartPolicy::new(10);
        let t = Instant::now();
        let delays: Vec<u64> = (0..7)
            .map(|_| match policy.on_exit(t) {
                RestartDecision::Restart { delay, .. } => delay.as_secs(),
                RestartDecision::GiveUp { .. } => u64::MAX,
            })
            .collect();
        assert_eq!(delays, [0, 1, 2, 4, 8, 8, 8]);
    }

    #[test]
    fn restart_policy_counts_only_the_last_ten_minutes() {
        let mut policy = RestartPolicy::new(1);
        let t = Instant::now();
        assert!(matches!(policy.on_exit(t), RestartDecision::Restart { .. }));
        assert!(matches!(policy.on_exit(t + Duration::from_secs(599)), RestartDecision::GiveUp { .. }));
        // 10분 넘게 재기동이 없었다: 횟수가 0으로 돌아간다.
        assert!(matches!(
            policy.on_exit(t + Duration::from_secs(601)),
            RestartDecision::Restart { attempt: 1, .. }
        ));
    }

    #[test]
    fn restart_limit_zero_disables_automatic_restarts() {
        let mut policy = RestartPolicy::new(0);
        assert_eq!(policy.on_exit(Instant::now()), RestartDecision::GiveUp { attempts: 0 });
    }

    #[test]
    fn manual_restart_resets_the_count() {
        let mut policy = RestartPolicy::new(1);
        let t = Instant::now();
        policy.on_exit(t);
        assert!(matches!(policy.on_exit(t), RestartDecision::GiveUp { .. }));
        policy.reset();
        assert!(matches!(policy.on_exit(t), RestartDecision::Restart { attempt: 1, .. }));
    }

    #[test]
    fn config_uses_defaults_for_missing_or_out_of_range_values() {
        let default = EngineConfig::default();
        assert_eq!(default.shutdown_grace, Duration::from_millis(7000));
        assert_eq!(default.restart_limit, 3);
        assert_eq!(EngineConfig::from_values(None, None), default);
        assert_eq!(EngineConfig::from_values(Some(999), Some(11)), default);
        assert_eq!(EngineConfig::from_values(Some(180_001), Some(-1)), default);
        let custom = EngineConfig::from_values(Some(5000), Some(0));
        assert_eq!(custom.shutdown_grace, Duration::from_millis(5000));
        assert_eq!(custom.restart_limit, 0);
    }

    #[test]
    fn engine_env_removes_only_bun_options() {
        let vars = vec![
            (OsString::from("PATH"), OsString::from("/bin")),
            (OsString::from("BUN_OPTIONS"), OsString::from("--inspect")),
            (OsString::from("BUN_OPTIONS_X"), OsString::from("keep")),
            (OsString::from("HOME"), OsString::from("/home/u")),
        ];
        let kept: Vec<String> = engine_env(vars)
            .into_iter()
            .map(|(k, _)| k.to_string_lossy().into_owned())
            .collect();
        assert_eq!(kept, ["PATH", "BUN_OPTIONS_X", "HOME"]);
    }

    #[test]
    fn stderr_lines_split_across_chunks_and_truncate_at_8_kib() {
        let mut splitter = StderrSplitter::default();
        assert_eq!(splitter.push(b"one\ntw"), ["one"]);
        assert_eq!(splitter.push(b"o\r\n"), ["two"]);
        let mut long = vec![b'x'; STDERR_LINE_MAX + 100];
        long.extend_from_slice(b"\nnext\n");
        let lines = splitter.push(&long);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].len(), STDERR_LINE_MAX);
        assert_eq!(lines[1], "next");
        assert_eq!(splitter.push(b"no newline"), Vec::<String>::new());
        assert_eq!(splitter.finish().as_deref(), Some("no newline"));
        assert_eq!(splitter.finish(), None);
    }

    #[test]
    fn shutdown_request_is_one_json_rpc_line() {
        let line = String::from_utf8(shutdown_request(7)).expect("utf8");
        assert!(line.ends_with('\n'));
        let value: serde_json::Value = serde_json::from_str(line.trim_end()).expect("json");
        assert_eq!(value["id"], "shell:shutdown:7");
        assert_eq!(value["method"], "host.shutdown");
        assert_eq!(value["params"]["reason"], "client_exit");
    }

    #[cfg(unix)]
    #[test]
    fn kill_process_group_refuses_pgid_zero_and_one() {
        assert!(kill_process_group(0).is_err());
        assert!(kill_process_group(1).is_err());
    }

    /// 실제 프로세스 그룹: 엔진 흉내(`sh`)와 같은 그룹의 손자가 함께 끝난다. 이미 없는 그룹은 성공이다.
    #[cfg(unix)]
    #[test]
    fn kill_process_group_ends_the_leader_and_its_group_members() {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};
        let mut leader = Command::new("sh")
            .args(["-c", "sleep 30 & echo $!; wait"])
            .stdout(Stdio::piped())
            .process_group(0)
            .spawn()
            .expect("spawn sh");
        let mut out = String::new();
        {
            use std::io::{BufRead, BufReader};
            let stdout = leader.stdout.take().expect("stdout");
            BufReader::new(stdout).read_line(&mut out).expect("grandchild pid");
        }
        let grandchild: i32 = out.trim().parse().expect("pid");
        let pid = leader.id();
        kill_process_group(pid).expect("kill group");
        leader.wait().expect("reap leader");
        let alive = |pid: i32| unsafe { libc::kill(pid, 0) } == 0;
        let mut gone = false;
        for _ in 0..100 {
            // 손자는 init에 입양된 뒤 수거된다. 좀비로 남는 짧은 시간을 기다린다.
            if !alive(grandchild) {
                gone = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(gone, "grandchild {grandchild} survived the group kill");
        kill_process_group(pid).expect("a group with no members is not an error");
    }

    // ----- 감독자: 가짜 엔진 -----

    #[derive(Clone)]
    struct EngineHandle {
        events: mpsc::Sender<EngineEvent>,
        written: Arc<Mutex<Vec<u8>>>,
        stdin_closed: Arc<AtomicBool>,
        gate: Arc<(Mutex<bool>, Condvar)>,
    }

    impl EngineHandle {
        async fn stdout(&self, bytes: &[u8]) {
            self.events.send(EngineEvent::Stdout(bytes.to_vec())).await.expect("send");
        }
        async fn crash(&self, code: i32) {
            self.events
                .send(EngineEvent::Terminated { code: Some(code), signal: None })
                .await
                .expect("send");
        }
        fn written(&self) -> String {
            String::from_utf8_lossy(&self.written.lock().expect("lock")).into_owned()
        }
    }

    struct FakeStdin {
        handle: EngineHandle,
        exit_on_eof: bool,
    }

    impl StdinSink for FakeStdin {
        fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            let (lock, cv) = &*self.handle.gate;
            let mut open = lock.lock().expect("lock");
            while !*open {
                open = cv.wait(open).expect("wait");
            }
            self.handle.written.lock().expect("lock").extend_from_slice(bytes);
            Ok(())
        }
    }

    impl Drop for FakeStdin {
        fn drop(&mut self) {
            self.handle.stdin_closed.store(true, Ordering::SeqCst);
            if self.exit_on_eof {
                // EOF를 읽은 엔진이 체크포인트하고 끝난다.
                let _ = self.handle.events.try_send(EngineEvent::Terminated { code: Some(0), signal: None });
            }
        }
    }

    #[derive(Clone, Copy)]
    struct Behavior {
        exit_on_eof: bool,
        /// 참이면 stdin 쓰기가 `release`(또는 kill_group)까지 막힌다.
        block_writes: bool,
    }

    struct FakeLauncher {
        behavior: Behavior,
        launches: AtomicU32,
        fail_launch: AtomicBool,
        handles: Mutex<Vec<EngineHandle>>,
        killed: Mutex<Vec<u32>>,
        /// kill_group이 불렸을 때 엔진을 종료시킨다.
        die_on_kill: bool,
    }

    impl FakeLauncher {
        fn new(behavior: Behavior, die_on_kill: bool) -> Arc<Self> {
            Arc::new(Self {
                behavior,
                launches: AtomicU32::new(0),
                fail_launch: AtomicBool::new(false),
                handles: Mutex::new(Vec::new()),
                killed: Mutex::new(Vec::new()),
                die_on_kill,
            })
        }
        fn handle(&self, n: usize) -> EngineHandle {
            self.handles.lock().expect("lock")[n].clone()
        }
    }

    impl Launcher for Arc<FakeLauncher> {
        fn launch(&self) -> Result<Launched, LaunchError> {
            if self.fail_launch.load(Ordering::SeqCst) {
                return Err(LaunchError("no such binary".into()));
            }
            let n = self.launches.fetch_add(1, Ordering::SeqCst) + 1;
            let (tx, rx) = mpsc::channel(8);
            let handle = EngineHandle {
                events: tx,
                written: Arc::new(Mutex::new(Vec::new())),
                stdin_closed: Arc::new(AtomicBool::new(false)),
                gate: Arc::new((Mutex::new(!self.behavior.block_writes), Condvar::new())),
            };
            self.handles.lock().expect("lock").push(handle.clone());
            Ok(Launched {
                pid: 1000 + n,
                events: rx,
                stdin: Box::new(FakeStdin { handle, exit_on_eof: self.behavior.exit_on_eof }),
            })
        }

        fn kill_group(&self, pid: u32) -> io::Result<()> {
            self.killed.lock().expect("lock").push(pid);
            if self.die_on_kill {
                if let Some(handle) = self.handles.lock().expect("lock").last() {
                    // 막힌 쓰기를 풀고 프로세스를 끝낸다.
                    *handle.gate.0.lock().expect("lock") = true;
                    handle.gate.1.notify_all();
                    let _ = handle.events.try_send(EngineEvent::Terminated { code: None, signal: Some(9) });
                }
            }
            Ok(())
        }
    }

    #[derive(Default)]
    struct NullSink {
        states: Mutex<Vec<EngineState>>,
        bytes: Mutex<Vec<u8>>,
    }
    impl Sink for NullSink {
        fn send_bytes(&self, bytes: Vec<u8>) -> Result<(), SinkClosed> {
            self.bytes.lock().expect("lock").extend(bytes);
            Ok(())
        }
        fn send_state(&self, state: &EngineState) -> Result<(), SinkClosed> {
            self.states.lock().expect("lock").push(state.clone());
            Ok(())
        }
    }

    struct Rig {
        launcher: Arc<FakeLauncher>,
        supervisor: Supervisor<Arc<FakeLauncher>>,
        relay: Arc<Relay>,
        sink: Arc<NullSink>,
    }

    fn rig(behavior: Behavior, die_on_kill: bool, restart_limit: u32) -> Rig {
        let launcher = FakeLauncher::new(behavior, die_on_kill);
        let relay = Arc::new(Relay::new(EngineState::Stopped));
        let sink = Arc::new(NullSink::default());
        relay.attach(sink.clone());
        let config = EngineConfig {
            shutdown_grace: Duration::from_millis(7000),
            restart_limit,
        };
        let supervisor = Supervisor::new(
            launcher.clone(),
            relay.clone(),
            config,
            Arc::new(AppLog::open(None)),
            Handle::current(),
        );
        Rig { launcher, supervisor, relay, sink }
    }

    async fn until<F: Fn() -> bool>(what: &str, f: F) {
        for _ in 0..500 {
            if f() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("timed out waiting for {what}");
    }

    fn kinds(sink: &NullSink) -> Vec<String> {
        sink.states
            .lock()
            .expect("lock")
            .iter()
            .map(|s| {
                serde_json::to_value(s).expect("json")["kind"].as_str().expect("kind").to_string()
            })
            .collect()
    }

    const EOF_EXIT: Behavior = Behavior { exit_on_eof: true, block_writes: false };

    #[tokio::test(start_paused = true)]
    async fn engine_output_reaches_the_page_and_state_goes_running() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.handle(0).stdout(b"{\"hello\":1}\n").await;
        until("bytes", || !rig.sink.bytes.lock().expect("lock").is_empty()).await;
        assert_eq!(*rig.sink.bytes.lock().expect("lock"), b"{\"hello\":1}\n");
        assert_eq!(kinds(&rig.sink), ["starting", "running"]);
    }

    #[tokio::test(start_paused = true)]
    async fn crashes_restart_with_backoff_then_fail_and_manual_restart_recovers() {
        let rig = rig(EOF_EXIT, true, 2);
        rig.supervisor.start();
        for n in 0..3usize {
            until("launch", || rig.launcher.launches.load(Ordering::SeqCst) as usize > n).await;
            until("running", || rig.launcher.handles.lock().expect("lock").len() > n).await;
            // 상태가 running이 된 뒤에 죽인다.
            tokio::time::sleep(Duration::from_millis(10)).await;
            rig.launcher.handle(n).crash(1).await;
        }
        until("failed", || kinds(&rig.sink).last().map(String::as_str) == Some("failed")).await;
        // limit 2: 최초 1번 + 자동 재기동 2번 = 3번 뜨고, 세 번째 종료에서 failed가 된다.
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 3);
        let seen = kinds(&rig.sink);
        assert_eq!(
            seen,
            ["starting", "running", "restarting", "starting", "running", "restarting", "starting", "running", "failed"]
        );
        assert!(matches!(rig.relay.state(), EngineState::Failed { attempts: 2, .. }));
        // 수동 재기동.
        assert_eq!(rig.supervisor.restart_manually(), Ok(()));
        until("relaunch", || rig.launcher.launches.load(Ordering::SeqCst) == 4).await;
        assert_eq!(rig.supervisor.restart_manually(), Err(CommandError::NotFailed));
    }

    #[tokio::test(start_paused = true)]
    async fn a_missing_binary_fails_without_retrying() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.launcher.fail_launch.store(true, Ordering::SeqCst);
        rig.supervisor.start();
        until("failed", || kinds(&rig.sink).last().map(String::as_str) == Some("failed")).await;
        tokio::time::sleep(Duration::from_secs(60)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 0);
        assert_eq!(kinds(&rig.sink), ["starting", "failed"]);
    }

    // 쓰기 스레드가 실제 시간으로 도는 경로라 가상 시계를 쓰지 않는다.
    #[tokio::test]
    async fn graceful_shutdown_writes_the_request_then_eof_and_does_not_wait_for_the_grace() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        let engine = rig.launcher.handle(0);
        let started = Instant::now();
        rig.supervisor.shutdown().await;
        assert!(started.elapsed() < Duration::from_secs(5), "ended on EOF, not on the grace deadline");
        let written = engine.written();
        assert!(written.contains("\"method\":\"host.shutdown\""), "{written}");
        assert!(engine.stdin_closed.load(Ordering::SeqCst));
        // 시한 안에 끝났더라도 남은 손자를 위해 그룹 SIGKILL을 한 번 보낸다.
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert_eq!(kinds(&rig.sink).last().map(String::as_str), Some("stopped"));
        assert!(kinds(&rig.sink).contains(&"stopping".to_string()));
        // 종료 중 쓰기는 거부한다.
        assert_eq!(rig.supervisor.write(b"x\n".to_vec()).await, Err(CommandError::EngineStopping));
    }

    #[tokio::test(start_paused = true)]
    async fn an_engine_that_ignores_eof_is_killed_only_after_the_grace_period() {
        let rig = rig(Behavior { exit_on_eof: false, block_writes: false }, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        let started = Instant::now();
        rig.supervisor.shutdown().await;
        let waited = started.elapsed();
        assert!(waited >= Duration::from_millis(7000), "EOF 처리 기회 없이 죽이면 안 된다: {waited:?}");
        assert!(waited < Duration::from_millis(7000 + 2500));
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert_eq!(kinds(&rig.sink).last().map(String::as_str), Some("stopped"));
    }

    /// 조건 2: stdin 쓰기가 막힌 채여도 종료 경로가 진행하고, 쓰기를 부른 쪽도 락에 묶이지 않는다.
    #[tokio::test(start_paused = true)]
    async fn shutdown_proceeds_while_a_stdin_write_is_blocked() {
        let rig = rig(Behavior { exit_on_eof: false, block_writes: true }, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        // 엔진이 stdin을 읽지 않는다. 쓰기 하나가 쓰기 스레드에서 막히고 나머지는 대기열에 쌓인다.
        for n in 0..4 {
            rig.supervisor.write(format!("{{\"n\":{n}}}\n").into_bytes()).await.expect("queued");
        }
        let supervisor = rig.supervisor.clone();
        let shutdown = tokio::spawn(async move { supervisor.shutdown().await });
        // 락을 쥔 쪽이 없으므로 종료 경로가 시한(7초)까지 가서 그룹을 죽이고 끝난다.
        timeout(Duration::from_secs(20), shutdown).await.expect("shutdown finished").expect("join");
        assert_eq!(*rig.launcher.killed.lock().expect("lock"), [1001]);
        assert_eq!(kinds(&rig.sink).last().map(String::as_str), Some("stopped"));
    }

    // 쓰기 스레드가 실제 시간으로 도는 경로라 가상 시계를 쓰지 않는다.
    #[tokio::test]
    async fn exit_requested_prevents_once_then_allows() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::PreventAndShutdown);
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::Prevent);
        rig.supervisor.shutdown().await;
        rig.supervisor.allow_exit();
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::Allow);
    }

    #[tokio::test(start_paused = true)]
    async fn exit_during_a_restart_backoff_cancels_the_restart() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.handle(0).crash(1).await; // 1번째 재기동은 즉시
        until("second launch", || rig.launcher.launches.load(Ordering::SeqCst) == 2).await;
        until("second running", || kinds(&rig.sink).iter().filter(|k| *k == "running").count() == 2).await;
        rig.launcher.handle(1).crash(1).await; // 2번째는 1초 백오프
        until("restarting", || kinds(&rig.sink).last().map(String::as_str) == Some("restarting")).await;
        assert_eq!(rig.supervisor.on_exit_requested(), ExitAction::Allow);
        tokio::time::sleep(Duration::from_secs(30)).await;
        assert_eq!(rig.launcher.launches.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn restarted_engine_starts_with_a_fresh_line_buffer() {
        let rig = rig(EOF_EXIT, true, 3);
        rig.supervisor.start();
        until("running", || kinds(&rig.sink).contains(&"running".to_string())).await;
        rig.launcher.handle(0).stdout(b"{\"id\":\"1\",\"resu").await;
        rig.launcher.handle(0).crash(1).await;
        until("second", || rig.launcher.launches.load(Ordering::SeqCst) == 2).await;
        until("second handle", || rig.launcher.handles.lock().expect("lock").len() == 2).await;
        rig.launcher.handle(1).stdout(b"{\"id\":\"2\"}\n").await;
        until("bytes", || !rig.sink.bytes.lock().expect("lock").is_empty()).await;
        assert_eq!(*rig.sink.bytes.lock().expect("lock"), b"{\"id\":\"2\"}\n");
    }
}
