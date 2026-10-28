// L4.desktop.plan §3.1 S1·S3 측정용 최소 Tauri 셸. 제품 코드가 아니다.
// 환경 변수로 동작을 고른다: SPIKE_SCENARIO(s1|s3), SPIKE_ENGINE, SPIKE_ENGINE_ARGS, SPIKE_PG, SPIKE_EXIT_POLICY(none|kill), SPIKE_SIGHANDLER, SPIKE_AUTOCLOSE_MS, SPIKE_CREDIT, SPIKE_CASES, SPIKE_LOG, SPIKE_RESULT. 사용은 ../s1-matrix.sh와 docs/xeon/L4/desktop/plan.md §3.1.1.
use std::fs::OpenOptions;
use std::io::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct EngineState {
    child: Mutex<Option<CommandChild>>,
    generation: AtomicU64,
    /// JS가 처리를 마쳤다고 알린 누적 바이트(신용 기반 역압)
    acked: AtomicU64,
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// SPIKE_LOG 파일에 `<epoch ms> <message>` 한 줄을 덧붙인다
fn log(message: &str) {
    if let Some(path) = env("SPIKE_LOG") {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{} {}", now_ms(), message);
        }
    }
}

fn spawn_engine(app: &AppHandle, args: Vec<String>, raw_out: bool) -> Result<(u64, u32), String> {
    let engine = env("SPIKE_ENGINE").ok_or("SPIKE_ENGINE not set")?;
    let process_group = env("SPIKE_PG").as_deref() != Some("0");
    let generation = app
        .state::<EngineState>()
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let (mut rx, child) = app
        .shell()
        .command(engine)
        .args(args)
        .set_raw_out(raw_out)
        .set_process_group(process_group)
        .current_dir(std::env::temp_dir())
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.pid();
    *app.state::<EngineState>().child.lock().unwrap() = Some(child);
    log(&format!("engine_spawned pid={pid} gen={generation} pg={process_group}"));
    if let Some(path) = env("SPIKE_SHELL_STATE") {
        let _ = std::fs::write(
            path,
            format!("{{\"shell\":{},\"engine\":{pid}}}", std::process::id()),
        );
    }
    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    if let Some(path) = env("SPIKE_ENGINE_STDERR") {
                        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
                            let _ = f.write_all(&bytes);
                            if !bytes.ends_with(b"\n") {
                                let _ = f.write_all(b"\n");
                            }
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    log(&format!(
                        "engine_terminated gen={generation} code={:?} signal={:?}",
                        payload.code, payload.signal
                    ));
                    let _ = &app_for_task;
                }
                _ => {}
            }
        }
    });
    Ok((generation, pid))
}

/// S3 릴레이: 엔진 stdout 바이트를 Channel로 보낸다. 프레임 앞에 [종류 1바이트][세대 8바이트 LE]를 붙인다.
/// 종류 0 = stdout 바이트, 1 = 종료(뒤에 exit code 문자열).
#[tauri::command]
async fn engine_start(
    app: AppHandle,
    on_event: Channel<InvokeResponseBody>,
    args: Vec<String>,
    raw: bool,
    credit: u64,
) -> Result<u64, String> {
    let engine = env("SPIKE_ENGINE").ok_or("SPIKE_ENGINE not set")?;
    let process_group = env("SPIKE_PG").as_deref() != Some("0");
    let generation = app
        .state::<EngineState>()
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let (mut rx, child) = app
        .shell()
        .command(engine)
        .args(args)
        .set_raw_out(true)
        .set_process_group(process_group)
        .current_dir(std::env::temp_dir())
        .spawn()
        .map_err(|e| e.to_string())?;
    *app.state::<EngineState>().child.lock().unwrap() = Some(child);
    app.state::<EngineState>().acked.store(0, Ordering::SeqCst);
    let app_for_credit = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut sent_messages: u64 = 0;
        let mut sent_bytes: u64 = 0;
        let mut last_report = Instant::now();
        while let Some(event) = rx.recv().await {
            let (kind, body): (u8, Vec<u8>) = match event {
                CommandEvent::Stdout(bytes) => (0, bytes),
                CommandEvent::Terminated(p) => (1, format!("{:?}", p.code).into_bytes()),
                _ => continue,
            };
            let mut framed = Vec::with_capacity(body.len() + 9);
            framed.push(kind);
            framed.extend_from_slice(&generation.to_le_bytes());
            framed.extend_from_slice(&body);
            let framed_len = framed.len();
            // credit > 0이면 JS가 처리한 양과 보낸 양의 차가 credit 이하일 때만 보낸다.
            // 이 동안 plugin 수신 채널(용량 1)이 차고, 읽기 스레드가 멈추고, 엔진 stdout 쓰기가 막힌다
            if credit > 0 {
                while sent_bytes.saturating_sub(app_for_credit.state::<EngineState>().acked.load(Ordering::SeqCst)) > credit {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            }
            let sent = if raw {
                on_event.send(InvokeResponseBody::Raw(framed))
            } else {
                // 원시 바이트가 아닌 경우의 비교군: Vec<u8>을 JSON 숫자 배열로 직렬화한다
                match serde_json::to_string(&framed) {
                    Ok(text) => on_event.send(InvokeResponseBody::Json(text)),
                    Err(e) => {
                        log(&format!("json_encode_error {e}"));
                        continue;
                    }
                }
            };
            if let Err(e) = sent {
                log(&format!("channel_send_error {e}"));
                break;
            }
            sent_messages += 1;
            sent_bytes += framed_len as u64;
            if last_report.elapsed() >= Duration::from_secs(1) {
                last_report = Instant::now();
                log(&format!("rust_sent gen={generation} messages={sent_messages} bytes={sent_bytes}"));
            }
            if kind == 1 {
                log(&format!("rust_sent_final gen={generation} messages={sent_messages} bytes={sent_bytes}"));
                break;
            }
        }
    });
    Ok(generation)
}

fn raw_body<'a>(request: &'a Request<'a>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.as_slice()),
        InvokeBody::Json(_) => Err("expected raw body".into()),
    }
}

fn write_to_engine(state: &EngineState, bytes: &[u8]) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    match guard.as_mut() {
        Some(child) => child.write(bytes).map_err(|e| e.to_string()),
        None => Err("no engine".into()),
    }
}

/// 비동기 명령 + spawn_blocking: 파이프가 차서 write가 막혀도 UI와 다른 명령은 돈다
#[tauri::command]
async fn engine_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let bytes = raw_body(&request)?.to_vec();
    tauri::async_runtime::spawn_blocking(move || {
        write_to_engine(&app.state::<EngineState>(), &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 동기 명령: Tauri 2에서 동기 명령은 메인 스레드에서 돈다. 비교군이다
#[tauri::command]
fn engine_write_main(state: State<'_, EngineState>, request: Request<'_>) -> Result<(), String> {
    write_to_engine(&state, raw_body(&request)?)
}

#[tauri::command]
fn engine_ack(state: State<'_, EngineState>, bytes: u64) {
    state.acked.fetch_add(bytes, Ordering::SeqCst);
}

#[tauri::command]
fn engine_kill(state: State<'_, EngineState>) -> Result<(), String> {
    let child = state.child.lock().unwrap().take();
    match child {
        Some(c) => c.kill().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
fn spike_config() -> serde_json::Value {
    serde_json::json!({
        "scenario": env("SPIKE_SCENARIO").unwrap_or_default(),
        "engine": env("SPIKE_ENGINE").unwrap_or_default(),
        "cases": env("SPIKE_CASES").unwrap_or_default(),
        "credit": env("SPIKE_CREDIT").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0),
    })
}

/// 결과를 파일에 쓰고 종료한다
#[tauri::command]
fn spike_report(app: AppHandle, json: String) {
    if let Some(path) = env("SPIKE_RESULT") {
        let _ = std::fs::write(path, json);
    }
    app.exit(0);
}

/// 동기 명령(메인 스레드에서 돈다): 메인 스레드가 막혔는지 재는 탐침
#[tauri::command]
fn spike_ping() -> u128 {
    now_ms()
}

#[tauri::command]
fn spike_log(message: String) {
    log(&format!("js {message}"));
}

fn kill_engine_group(app: &AppHandle) {
    let child = app.state::<EngineState>().child.lock().unwrap().take();
    if let Some(child) = child {
        let result = child.kill();
        log(&format!("exit_policy_kill result_ok={}", result.is_ok()));
    }
}

fn main() {
    let scenario = env("SPIKE_SCENARIO").unwrap_or_else(|| "idle".into());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(EngineState {
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
            acked: AtomicU64::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            engine_start,
            engine_write,
            engine_write_main,
            engine_kill,
            engine_ack,
            spike_config,
            spike_report,
            spike_log,
            spike_ping
        ])
        .setup(move |app| {
            log(&format!("setup shell_pid={} scenario={scenario}", std::process::id()));
            let handle = app.handle().clone();

            // S1: JS 없이 Rust가 엔진을 바로 띄운다
            if scenario == "s1" {
                let args: Vec<String> = env("SPIKE_ENGINE_ARGS")
                    .map(|s| s.split_whitespace().map(String::from).collect())
                    .unwrap_or_default();
                spawn_engine(&handle, args, true)?;
            }

            // E2의 "Unix 신호 처리기" 변형: SIGTERM을 받아 app.exit로 RunEvent::Exit을 일으킨다
            if env("SPIKE_SIGHANDLER").as_deref() == Some("1") {
                let h = handle.clone();
                std::thread::spawn(move || {
                    use signal_hook::consts::{SIGINT, SIGTERM};
                    use signal_hook::iterator::Signals;
                    if let Ok(mut signals) = Signals::new([SIGTERM, SIGINT]) {
                        for sig in signals.forever() {
                            log(&format!("signal_received {sig}"));
                            h.exit(0);
                            break;
                        }
                    }
                });
            }

            // 창 닫기 재현: 창 관리자의 X 단추와 같은 CloseRequested 경로(window.close())를 N ms 뒤에 탄다
            if let Some(ms) = env("SPIKE_AUTOCLOSE_MS").and_then(|v| v.parse::<u64>().ok()) {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(ms));
                    log("autoclose_window_close");
                    if let Some(w) = h.get_webview_window("main") {
                        let _ = w.close();
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("build tauri app");

    let started = Instant::now();
    app.run(move |handle, event| match event {
        RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { .. },
            ..
        } => log("CloseRequested"),
        RunEvent::ExitRequested { code, .. } => {
            log(&format!("ExitRequested code={code:?}"));
        }
        RunEvent::Exit => {
            log(&format!("Exit uptime_ms={}", started.elapsed().as_millis()));
            if env("SPIKE_EXIT_POLICY").as_deref() == Some("kill") {
                kill_engine_group(handle);
            }
        }
        _ => {}
    });
}
