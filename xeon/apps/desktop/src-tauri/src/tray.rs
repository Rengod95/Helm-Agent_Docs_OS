//! 트레이(메뉴 막대) 아이콘 (B-10). 창을 닫아도 셸과 엔진이 남는 트레이 유지 모드의 길이다.
//! 메뉴는 "열기", "새 대화", 진행 중 개수(비활성), "끝내기"다. 처음 글은 영어 기본값이고, WebView가 `tray_update`로 바꾼다.
//! 아이콘은 macOS 메뉴 막대 템플릿 이미지다. 만들지 못하면 `TrayActive(false)`이고, 그때 창을 닫으면 앱도 끝난다.

use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::applog::AppLog;
use crate::relay::CommandError;
use crate::shell_intent::{self, Intent};

/// 메뉴 막대 아이콘. 44x44 검정 불투명과 투명 배경의 템플릿 PNG다.
const ICON: &[u8] = include_bytes!("../icons/tray.png");
const TRAY_ID: &str = "fresnel";
/// 글 길이 상한(문자 수). 이보다 긴 글은 `BadRequest`다.
const LABEL_MAX_CHARS: usize = 80;

const ID_OPEN: &str = "open";
const ID_NEW_THREAD: &str = "new_thread";
const ID_RUNNING: &str = "running";
const ID_QUIT: &str = "quit";

const DEFAULT_OPEN: &str = "Open Fresnel";
const DEFAULT_NEW_THREAD: &str = "New chat";
/// `{count}`는 진행 중 개수로 바뀐다.
const DEFAULT_RUNNING: &str = "Running {count}";
const DEFAULT_QUIT: &str = "Quit";

/// 트레이 메뉴 항목. 트레이를 만들었을 때만 상태에 있고, `tray_update`가 글을 바꾼다.
pub struct TrayItems {
    open: MenuItem<Wry>,
    new_thread: MenuItem<Wry>,
    running: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// 트레이를 만들었는지. `false`면 창을 닫을 때 트레이로 남을 곳이 없어 앱이 끝난다 (`desktop_settings::effective_close_behavior`).
pub struct TrayActive(pub bool);

/// 메뉴 항목 id가 가리키는 동작.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    Open,
    NewThread,
    Quit,
}

/// 메뉴 항목 id를 동작으로 바꾼다. 진행 중 줄은 비활성이라 이벤트가 오지 않고, 알 수 없는 id도 `None`이다.
pub fn action_of(id: &str) -> Option<TrayAction> {
    match id {
        ID_OPEN => Some(TrayAction::Open),
        ID_NEW_THREAD => Some(TrayAction::NewThread),
        ID_QUIT => Some(TrayAction::Quit),
        _ => None,
    }
}

/// 진행 중 줄의 글. 템플릿의 `{count}`를 모두 개수로 바꾼다.
pub fn running_text(template: &str, count: u32) -> String {
    template.replace("{count}", &count.to_string())
}

/// `tray_update`가 받는 글. `running`은 `{count}`가 든 템플릿이다.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    open: String,
    new_thread: String,
    running: String,
    quit: String,
}

/// `tray_update`의 답. WebView는 `kind`로 가른다. 실패는 이유 코드만 담는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TrayReply {
    Updated,
    /// 트레이를 만들지 못했다.
    Unavailable,
    /// 메뉴 호출이 실패했다.
    Failed {
        reason: &'static str,
    },
}

/// 글이 모두 상한 안인지 본다. 글자 수로 센다.
fn labels_fit(labels: &TrayLabels) -> bool {
    [
        &labels.open,
        &labels.new_thread,
        &labels.running,
        &labels.quit,
    ]
    .iter()
    .all(|text| text.chars().count() <= LABEL_MAX_CHARS)
}

/// 트레이를 만들고 메뉴 항목을 상태에 둔다. `.setup`이 한 번 부른다. 만들었으면 `true`다.
/// 못 만들면 이유 코드 한 줄만 앱 로그에 남기고 `false`를 돌려준다(예: 리눅스에 appindicator가 없을 때).
pub fn create(app: &AppHandle, log: &AppLog) -> bool {
    match try_create(app) {
        Ok(items) => {
            app.manage(items);
            true
        }
        Err(reason) => {
            log.line(&format!("tray: not created (reason: {reason})"));
            false
        }
    }
}

fn try_create(app: &AppHandle) -> Result<TrayItems, &'static str> {
    let icon = Image::from_bytes(ICON).map_err(|_| "icon")?;
    let items = TrayItems {
        open: MenuItem::with_id(app, ID_OPEN, DEFAULT_OPEN, true, None::<&str>)
            .map_err(|_| "menu")?,
        new_thread: MenuItem::with_id(app, ID_NEW_THREAD, DEFAULT_NEW_THREAD, true, None::<&str>)
            .map_err(|_| "menu")?,
        running: MenuItem::with_id(
            app,
            ID_RUNNING,
            running_text(DEFAULT_RUNNING, 0),
            false,
            None::<&str>,
        )
        .map_err(|_| "menu")?,
        quit: MenuItem::with_id(app, ID_QUIT, DEFAULT_QUIT, true, None::<&str>)
            .map_err(|_| "menu")?,
    };
    let first_separator = PredefinedMenuItem::separator(app).map_err(|_| "menu")?;
    let second_separator = PredefinedMenuItem::separator(app).map_err(|_| "menu")?;
    let menu = Menu::with_items(
        app,
        &[
            &items.open,
            &items.new_thread,
            &first_separator,
            &items.running,
            &second_separator,
            &items.quit,
        ],
    )
    .map_err(|_| "menu")?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .show_menu_on_left_click(true)
        .menu(&menu)
        .on_menu_event(on_menu_event)
        .build(app)
        .map_err(|_| "build")?;
    Ok(items)
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    let id: &str = event.id().as_ref();
    match action_of(id) {
        Some(TrayAction::Open) => crate::reopen_main(app),
        Some(TrayAction::NewThread) => {
            crate::reopen_main(app);
            shell_intent::send(app, Intent::NewThread);
        }
        Some(TrayAction::Quit) => app.exit(0),
        None => {}
    }
}

impl TrayItems {
    /// 네 항목의 글을 바꾼다. 하나라도 실패하면 그 오류를 돌려준다.
    fn apply(&self, labels: &TrayLabels, running: &str) -> tauri::Result<()> {
        self.open.set_text(&labels.open)?;
        self.new_thread.set_text(&labels.new_thread)?;
        self.running.set_text(running)?;
        self.quit.set_text(&labels.quit)
    }
}

/// 메뉴 글과 진행 중 개수를 바꾼다. 글이 80자를 넘으면 `BadRequest`다.
/// 트레이가 없으면 `unavailable`, 메뉴 호출이 실패하면 `failed`를 값으로 돌려준다. 앱은 계속 돈다.
/// 메뉴 작업은 메인 스레드에서 하므로 비동기 명령이다. 동기 명령은 메인 스레드에서 돌아 그 작업을 기다리면 멈춘다.
#[tauri::command]
pub async fn tray_update(
    app: AppHandle,
    labels: TrayLabels,
    running: u32,
) -> Result<TrayReply, CommandError> {
    if !labels_fit(&labels) {
        return Err(CommandError::BadRequest);
    }
    let Some(items) = app.try_state::<TrayItems>() else {
        return Ok(TrayReply::Unavailable);
    };
    let running_label = running_text(&labels.running, running);
    Ok(match items.apply(&labels, &running_label) {
        Ok(()) => TrayReply::Updated,
        Err(_) => TrayReply::Failed { reason: "set_text" },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn labels_with(open: &str) -> TrayLabels {
        TrayLabels {
            open: open.into(),
            new_thread: "New chat".into(),
            running: "Running {count}".into(),
            quit: "Quit".into(),
        }
    }

    #[test]
    fn each_menu_id_maps_to_its_action_and_the_rest_to_nothing() {
        assert_eq!(action_of("open"), Some(TrayAction::Open));
        assert_eq!(action_of("new_thread"), Some(TrayAction::NewThread));
        assert_eq!(action_of("quit"), Some(TrayAction::Quit));
        for id in ["running", "", "Quit", "new-thread", "separator"] {
            assert_eq!(action_of(id), None, "{id:?}");
        }
    }

    #[test]
    fn the_running_line_puts_the_count_into_every_marker() {
        assert_eq!(running_text("진행 중 {count}", 0), "진행 중 0");
        assert_eq!(running_text("Running {count}", 12), "Running 12");
        assert_eq!(running_text("{count} of {count}", 3), "3 of 3");
        assert_eq!(running_text("no marker", 7), "no marker");
    }

    #[test]
    fn the_first_running_line_is_the_english_default() {
        assert_eq!(running_text(DEFAULT_RUNNING, 0), "Running 0");
    }

    #[test]
    fn labels_are_capped_at_eighty_characters_counted_as_characters() {
        assert!(labels_fit(&labels_with(&"a".repeat(80))));
        assert!(!labels_fit(&labels_with(&"a".repeat(81))));
        // 한글 80자는 240바이트다. 글자 수로 세므로 들어간다.
        assert!(labels_fit(&labels_with(&"가".repeat(80))));
        assert!(!labels_fit(&labels_with(&"가".repeat(81))));

        let long_running = TrayLabels {
            running: "a".repeat(81),
            ..labels_with("Open")
        };
        assert!(!labels_fit(&long_running));
        let long_quit = TrayLabels {
            quit: "a".repeat(81),
            ..labels_with("Open")
        };
        assert!(!labels_fit(&long_quit));
    }

    #[test]
    fn labels_arrive_in_camel_case_and_the_replies_serialize_with_a_kind_tag() {
        let labels: TrayLabels = serde_json::from_value(json!({
            "open": "열기",
            "newThread": "새 대화",
            "running": "진행 중 {count}",
            "quit": "끝내기"
        }))
        .expect("the labels parse");
        assert_eq!(
            labels,
            TrayLabels {
                open: "열기".into(),
                new_thread: "새 대화".into(),
                running: "진행 중 {count}".into(),
                quit: "끝내기".into(),
            }
        );

        assert_eq!(
            serde_json::to_value(TrayReply::Updated).expect("the reply serializes"),
            json!({ "kind": "updated" })
        );
        assert_eq!(
            serde_json::to_value(TrayReply::Unavailable).expect("the reply serializes"),
            json!({ "kind": "unavailable" })
        );
        assert_eq!(
            serde_json::to_value(TrayReply::Failed { reason: "set_text" })
                .expect("the reply serializes"),
            json!({ "kind": "failed", "reason": "set_text" })
        );
    }
}
