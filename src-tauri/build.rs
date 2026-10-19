use std::path::Path;

/// 每个随包 pilo-server 运行时，以及它服务的 Rust 编译目标。
const SERVER_RESOURCES: &[(&str, &str)] = &[
    ("x86_64-pc-windows-msvc", "pilo-server-windows-x86_64.exe"),
    ("x86_64-unknown-linux-gnu", "pilo-server-linux-x86_64"),
    ("aarch64-unknown-linux-gnu", "pilo-server-linux-aarch64"),
    ("aarch64-apple-darwin", "pilo-server-darwin-aarch64"),
];

fn main() {
    // 只对存在文件发 rerun-if-changed：cargo 把不存在的路径当作“永远变更”，
    // 会让本 build script（以及 pilo crate）每次构建都重跑。
    // 监听 resources 目录本身，这样后续新增运行时也能被感知。
    println!("cargo:rerun-if-changed=resources");
    for (_, resource) in SERVER_RESOURCES {
        if Path::new("resources").join(resource).is_file() {
            println!("cargo:rerun-if-changed=resources/{resource}");
        }
    }
    println!("cargo:rerun-if-env-changed=PILO_REQUIRE_FULL_SERVER_BUNDLE");

    if std::env::var("PROFILE").as_deref() == Ok("release") {
        check_not_dev_build();
        check_server_runtimes();
    }

    tauri_build::build()
}

/// `cargo build --release` 不会打开 `tauri/custom-protocol`（只有 Tauri CLI 会），
/// 这样产出的二进制仍然是 dev 形态：不内嵌 `frontendDist`，窗口直接指向 `devUrl`，
/// 脱离 `pnpm tauri dev` 运行时只显示「无法访问此页面」。这里提前失败，
/// 避免把这种二进制当成发布版打包出去。
fn check_not_dev_build() {
    // 直接用 DEP_TAURI_DEV（tauri 的 build script 通过 `cargo:dev` 导出）；
    // tauri_build::is_dev() 在变量缺失时会 panic，不适用于手工执行的场景。
    let is_dev = std::env::var_os("DEP_TAURI_DEV").map(|value| value == "true") == Some(true);
    if !is_dev {
        return;
    }
    panic!(
        "release build must go through `pnpm tauri build`: it enables the tauri/custom-protocol \
         feature that embeds the frontend and serves it from tauri://localhost. Without it the \
         binary loads devUrl and shows a blank page. Alternatively pass \
         `--features tauri/custom-protocol` to cargo explicitly."
    );
}

/// Release 构建默认只要求当前编译目标的运行时，本地单平台打包因此无需先准备
/// 全部平台的产物。发布流水线会设置 `PILO_REQUIRE_FULL_SERVER_BUNDLE=1`
/// 恢复四平台完整性校验（`scripts/verify-pilo-server-resources.sh` 也校验同一集合）。
/// 没有对应运行时的目标（例如未支持的主机架构）不做校验，仍可产出诊断用二进制。
fn check_server_runtimes() {
    let target = std::env::var("TARGET").unwrap_or_default();
    let full_bundle = env_flag("PILO_REQUIRE_FULL_SERVER_BUNDLE");
    let required: Vec<&str> = if full_bundle {
        SERVER_RESOURCES
            .iter()
            .map(|(_, resource)| *resource)
            .collect()
    } else {
        SERVER_RESOURCES
            .iter()
            .filter(|(triple, _)| *triple == target.as_str())
            .map(|(_, resource)| *resource)
            .collect()
    };

    let missing: Vec<&str> = required
        .iter()
        .copied()
        .filter(|resource| !Path::new("resources").join(resource).is_file())
        .collect();
    if missing.is_empty() {
        return;
    }

    if full_bundle {
        panic!(
            "release bundle is missing pilo-server runtimes: {}. Stage every supported target before packaging, or unset PILO_REQUIRE_FULL_SERVER_BUNDLE for a local single-platform build",
            missing.join(", ")
        );
    }
    panic!(
        "release build for {target} is missing pilo-server runtime: {}. Before packaging, build the release runtime with pnpm server:build:win on Windows or bash scripts/build-pilo-server.sh on macOS/Linux (pass an explicit server target when cross-compiling)",
        missing.join(", ")
    );
}

/// 构建开关：只有非空且不是 `0`/`false` 时才视为开启，
/// 避免 `PILO_REQUIRE_FULL_SERVER_BUNDLE=0` 反而触发严格校验。
fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            !value.is_empty() && value != "0" && value != "false"
        })
        .unwrap_or(false)
}
