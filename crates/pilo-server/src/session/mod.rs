mod activity;
mod index;
mod io;
mod search;
mod watch;

use std::{borrow::Cow, path::PathBuf};

pub(crate) use activity::session_activity;
pub(crate) use index::session_scan;
pub(crate) use io::{session_delete, session_discover, session_read};
pub(crate) use search::session_search;
pub(crate) use watch::{session_watch_start, session_watch_stop};

#[cfg(test)]
pub(crate) use index::{
    SESSION_INDEX_HEADER_BYTES, SESSION_INDEX_PREFIX_STAGES, SESSION_INDEX_TAIL_BYTES,
    SessionIndexSummary, scan_index, summarize_index_bytes,
};
#[cfg(test)]
pub(crate) use watch::{collect_session_change_paths, is_session_change};

/// Pi 的会话目录名由项目 cwd 编码而来。Windows 的 `fs::canonicalize` 会返回
/// `\\?\C:\...` 形式的 verbatim 路径，不去掉前缀就会拼出含 `?` 的非法目录名，
/// `read_dir` 直接以 ERROR_INVALID_NAME(os error 123) 失败：会话列表、搜索、
/// 文件监听和外部活动探测会一起失效。
fn session_dir_key(project: &str) -> String {
    let normalized = windows_verbatim_path(project.trim());
    let normalized = normalized.trim_start_matches(['/', '\\']);
    format!("--{}--", normalized.replace(['/', '\\', ':'], "-"))
}

/// 只剥离 Windows verbatim 前缀；普通路径（含 POSIX 路径）原样返回，
/// 不解析 `..`、不做大小写归并。
fn windows_verbatim_path(value: &str) -> Cow<'_, str> {
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return Cow::Owned(format!(r"\\{rest}"));
    }
    match value.strip_prefix(r"\\?\") {
        Some(rest) => Cow::Borrowed(rest),
        None => Cow::Borrowed(value),
    }
}

fn agent_dir() -> Option<PathBuf> {
    std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".pi/agent")))
        .or_else(|| {
            std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".pi/agent"))
        })
}

#[cfg(test)]
mod tests {
    use super::{session_dir_key, windows_verbatim_path};

    #[test]
    fn verbatim_windows_paths_lose_their_prefix() {
        for (input, expected) in [
            (r"\\?\E:\my_projects\pilo", r"E:\my_projects\pilo"),
            (r"\\?\UNC\server\share\code", r"\\server\share\code"),
            (r"E:\my_projects\pilo", r"E:\my_projects\pilo"),
            ("/root/code/pilo", "/root/code/pilo"),
            ("", ""),
        ] {
            assert_eq!(windows_verbatim_path(input), expected, "input={input}");
        }
    }

    /// `--E--my_projects-pilo--` 就是 Pi 在 `~/.pi/agent/sessions` 下真实创建的目录名。
    #[test]
    fn session_dir_key_matches_pi_directory_names() {
        for (project, expected) in [
            ("/root/code/pilo", "--root-code-pilo--"),
            (r"E:\my_projects\pilo", "--E--my_projects-pilo--"),
            (r"\\?\E:\my_projects\pilo", "--E--my_projects-pilo--"),
            (r"\\?\UNC\server\share\code", "--server-share-code--"),
            (r"\\server\share\code", "--server-share-code--"),
        ] {
            assert_eq!(session_dir_key(project), expected, "project={project}");
        }
    }
}
