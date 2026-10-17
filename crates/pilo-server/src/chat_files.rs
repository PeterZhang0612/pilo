use std::{fs, io::Write, path::PathBuf};

use pilo_protocol::MAX_CHAT_FILE_BYTES;
use serde::Deserialize;
use serde_json::Value;

use crate::{extensions::runtime_directory, fs_ops::checked_mutation_path, to_value};

#[derive(Deserialize)]
pub(crate) struct ChatFileUploadParams {
    id: String,
    name: String,
}

#[derive(Deserialize)]
pub(crate) struct ChatFileRemoveParams {
    path: String,
}

fn valid_id(id: &str) -> bool {
    id.len() == 22
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        && matches!(id.as_bytes().last(), Some(b'A' | b'Q' | b'g' | b'w'))
}

fn valid_name(name: &str) -> bool {
    !(name.is_empty()
        || name.len() > 240
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name.contains(['/', '\\', ':', '"', '<', '>', '|', '?', '*'])
        || name.chars().any(char::is_control))
}

fn attachment_root() -> Result<PathBuf, String> {
    let runtime = runtime_directory().map_err(|error| error.to_string())?;
    let runtime = runtime.to_str().ok_or("server runtime path is not UTF-8")?;
    // Reuse the filesystem boundary checks; an attachments symlink is not a destination.
    let (_, root) = checked_mutation_path(runtime, "attachments")?;
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    fs::canonicalize(root).map_err(|error| error.to_string())
}

fn mention_path(path: &std::path::Path) -> Result<String, String> {
    let value = path.to_str().ok_or("chat attachment path is not UTF-8")?;
    if cfg!(windows) {
        // Pi needs normal Windows paths, not canonicalize's verbatim prefix.
        let value = value.replace('\\', "/");
        if let Some(value) = value.strip_prefix("//?/UNC/") {
            return Ok(format!("//{value}"));
        }
        return Ok(value.strip_prefix("//?/").unwrap_or(&value).to_owned());
    }
    Ok(value.to_owned())
}

pub(crate) fn upload(params: ChatFileUploadParams, data: Vec<u8>) -> Result<Value, String> {
    if data.len() > MAX_CHAT_FILE_BYTES {
        return Err("chat attachment exceeds the 10 MB limit".to_owned());
    }
    let name = params.name.trim();
    if !valid_id(&params.id) || !valid_name(name) {
        return Err("invalid chat attachment filename or id".to_owned());
    }
    let directory = attachment_root()?.join(&params.id);
    // Never reuse an existing directory, even if the host supplied a duplicate id.
    fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let result = (|| {
        let path = directory.join(name);
        let value = mention_path(&path)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        file.write_all(&data).map_err(|error| error.to_string())?;
        to_value(value)
    })();
    if result.is_err()
        && let Err(error) = fs::remove_dir_all(&directory)
    {
        eprintln!("[chat-attachments] failed to clean up unsuccessful upload: {error}");
    }
    result
}

pub(crate) fn remove(params: ChatFileRemoveParams) -> Result<Value, String> {
    let root = attachment_root()?;
    let prefix = format!("{}/", mention_path(&root)?);
    let (id, name) = params
        .path
        .strip_prefix(prefix.as_str())
        .and_then(|relative| relative.split_once('/'))
        .ok_or_else(|| "invalid chat attachment path".to_owned())?;
    if !valid_id(id) || !valid_name(name) {
        return Err("invalid chat attachment path".to_owned());
    }
    fs::remove_dir_all(root.join(id)).map_err(|error| error.to_string())?;
    Ok(Value::Null)
}
