//! 엔진과 `xeon secret` 자식의 PATH 보강(L4.desktop.spec E7).
//! Finder로 띄운 macOS 앱의 PATH는 `/usr/bin:/bin:/usr/sbin:/sbin`뿐이라 sops, age, rg를 찾지 못한다.
//! 기존 항목과 순서는 그대로 두고, 없는 도구 디렉터리만 뒤에 붙인다.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// 기존 PATH 뒤에 붙이는 고정 디렉터리(Homebrew, /usr/local).
const FIXED_DIRS: [&str; 3] = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"];

/// PATH를 보강한다. 기존 항목은 순서대로 남기고, 없는 디렉터리만 뒤에 붙인다.
/// 붙이는 순서는 Homebrew 두 개, `/usr/local/bin`, `<home>/.local/bin`, `<home>/.nix-profile/bin`이다(뒤의 두 개는 home이 있을 때만).
/// 빈 항목은 버린다. 붙일 수 없는 값(구분자가 든 홈 경로 등)이면 원래 값을 그대로 돌려준다.
pub fn augment_path(path: Option<OsString>, home: Option<&Path>) -> OsString {
    let mut entries: Vec<PathBuf> = match &path {
        Some(value) => std::env::split_paths(value)
            .filter(|entry| !entry.as_os_str().is_empty())
            .collect(),
        None => Vec::new(),
    };
    let mut wanted: Vec<PathBuf> = FIXED_DIRS.iter().map(PathBuf::from).collect();
    if let Some(home) = home {
        wanted.push(home.join(".local/bin"));
        wanted.push(home.join(".nix-profile/bin"));
    }
    for dir in wanted {
        if !entries.contains(&dir) {
            entries.push(dir);
        }
    }
    std::env::join_paths(&entries).unwrap_or_else(|_| path.unwrap_or_default())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    const ADDED: &str = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/u/.local/bin:/Users/u/.nix-profile/bin";

    fn os(value: &str) -> OsString {
        OsString::from(value)
    }

    #[test]
    fn a_finder_path_gets_the_tool_dirs_appended_in_order() {
        assert_eq!(
            augment_path(
                Some(os("/usr/bin:/bin:/usr/sbin:/sbin")),
                Some(Path::new("/Users/u"))
            ),
            os(&format!("/usr/bin:/bin:/usr/sbin:/sbin:{ADDED}"))
        );
    }

    #[test]
    fn a_dir_already_on_the_path_is_not_repeated_and_keeps_its_place() {
        assert_eq!(
            augment_path(
                Some(os("/usr/local/bin:/usr/bin:/opt/homebrew/bin")),
                Some(Path::new("/Users/u"))
            ),
            os("/usr/local/bin:/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/Users/u/.local/bin:/Users/u/.nix-profile/bin")
        );
    }

    #[test]
    fn user_dirs_stay_first_and_a_home_dir_already_listed_is_kept_where_it_is() {
        assert_eq!(
            augment_path(
                Some(os("/Users/u/.local/bin:/Users/u/bin:/usr/bin")),
                Some(Path::new("/Users/u"))
            ),
            os("/Users/u/.local/bin:/Users/u/bin:/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/u/.nix-profile/bin")
        );
    }

    #[test]
    fn without_a_home_only_the_fixed_dirs_are_added() {
        assert_eq!(
            augment_path(Some(os("/usr/bin:/bin")), None),
            os("/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin")
        );
    }

    #[test]
    fn a_missing_or_empty_path_yields_only_the_added_dirs() {
        assert_eq!(augment_path(None, Some(Path::new("/Users/u"))), os(ADDED));
        assert_eq!(
            augment_path(Some(os("")), Some(Path::new("/Users/u"))),
            os(ADDED)
        );
        assert_eq!(
            augment_path(Some(os("/usr/bin::")), None),
            os("/usr/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin")
        );
    }

    #[test]
    fn a_value_that_cannot_be_joined_is_returned_unchanged() {
        assert_eq!(
            augment_path(Some(os("/usr/bin")), Some(Path::new("/Users/a:b"))),
            os("/usr/bin")
        );
    }
}
