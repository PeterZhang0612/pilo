use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::PathBuf,
};

use pilo_protocol::BuiltinExtension;

const SOURCES: &[(&str, &str)] = &[
    (
        "cache-keep-alive.js",
        include_str!("../extensions/cache-keep-alive.js"),
    ),
    (
        "next-prompt.js",
        include_str!("../extensions/next-prompt.js"),
    ),
    (
        "ssh-workspace.js",
        include_str!("../extensions/ssh-workspace.js"),
    ),
    (
        "model-catalog.js",
        include_str!("../extensions/model-catalog.js"),
    ),
];

/// Never default to the executable directory: installed resources may be read-only.
pub fn runtime_directory() -> io::Result<PathBuf> {
    if let Some(root) = std::env::var_os("PILO_SERVER_RUNTIME_DIR") {
        let root = PathBuf::from(root);
        if !root.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Pilo runtime directory must be absolute",
            ));
        }
        return Ok(root);
    }
    #[cfg(windows)]
    let cache = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let cache = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")));
    cache
        .map(|cache| {
            let app = if cfg!(debug_assertions) {
                "pilo-dev"
            } else {
                "pilo"
            };
            cache.join(app).join("server")
        })
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "Pilo runtime cache directory is unavailable",
            )
        })
}

pub(crate) fn deploy() -> io::Result<PathBuf> {
    let dir = runtime_directory()?.join("extensions");
    fs::create_dir_all(&dir)?;
    for &(name, source) in SOURCES {
        let path = dir.join(name);
        match fs::read(&path) {
            Ok(bytes) if bytes == source.as_bytes() => continue,
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        // A same-directory replacement never exposes a partially written script.
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_nanos();
        let temporary = dir.join(format!(".{name}.{}.{nonce}.tmp", std::process::id()));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(source.as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, &path)
        })();
        let _ = fs::remove_file(&temporary);
        result?;
    }
    fs::canonicalize(dir)
}

pub(crate) fn filename(extension: &BuiltinExtension) -> &'static str {
    match extension {
        BuiltinExtension::NextPrompt => "next-prompt.js",
        BuiltinExtension::CacheKeepAlive => "cache-keep-alive.js",
        BuiltinExtension::ModelCatalog => "model-catalog.js",
        BuiltinExtension::SshWorkspace { .. } => "ssh-workspace.js",
    }
}
