# 实施计划

## 状态与执行约束

- 用户已在后续对话批准实施，任务已进入 in_progress；产品代码已实现，仍待运行验证与提交批准。
- 单任务包含预测和内置扩展部署，三个扩展是同一固定部署机制的使用者；按下列顺序在主会话实施，不派发子 Agent。
- 实施批准已获得；用户在请求运行检查/构建后要求继续，已执行此范围验证。不运行测试、GUI 和环境验证，不提交。
- 不新增/修改测试；测试和桌面/浏览器验证仍需独立授权。已运行的代码检查/构建见实际检查记录；计划不等于运行结果。

## 适用规范

实施前加载 trellis-before-dev，并读取：

- `.trellis/spec/backend/index.md`、`directory-structure.md`、`database-guidelines.md`、`remote-webui.md`、`runtime-lifecycle.md`、`quality-guidelines.md`、`error-handling.md`、`logging-guidelines.md`。
- `.trellis/spec/frontend/index.md`、`component-guidelines.md`、`hook-guidelines.md`、`state-management.md`、`type-safety.md`、`quality-guidelines.md`。
- `.trellis/spec/backend/project-model-scope.md`（Host-owned 设置、共享 picker 和同步模式）。
- `.trellis/spec/guides/index.md`、`cross-layer-thinking-guide.md`、`code-reuse-thinking-guide.md`。

## 1. 确认调用边界

- [x] 读取 PRD、设计和研究，列出最小行为差距、修改文件及各调用者，确认任务范围未扩张。
- [x] 检查 Server 源码/资源目录布局、内嵌入口、runtime root 传递、构建指纹、Windows 同步脚本和 CI 路径过滤。
- [x] 检查 normal chat、WebUI start、model catalog、parallel 和 SSH runtime profile 的 launch 字段，定位所有内联内置扩展调用者。
- [x] 核对实际 Pi API/版本的 complete、取消、reasoning、setWidget 和 agent_settled；不支持时保留聊天并关闭预测，不推测回退。

## 2. 固定部署并迁移内置扩展

- [x] 将 SSH workspace 与 model catalog 内置逻辑迁入 `crates/pilo-server/extensions/` 单文件，保留现有工具、命令和结果行为。
- [x] 建立小型静态内置 ID 到文件的映射，随 Server 携带源码，在用户 Runtime 根目录部署/更新/补齐固定扩展文件；不引入 Package、版本目录或通用插件注册框架。
- [x] 为 Pi 启动增加独立内置扩展选择和进程专属配置字段，不改变现有 extensions 源码参数的含义。
- [x] SSH 动态配置由各子进程专属环境传递，禁用发现时依然显式加载，确保不同 Session 不改写共享源码。
- [x] 模型探测加载固定 model-catalog，移除前端内联源码常量；原前端文件仅保留命令/结果标题常量。旧 SSH 源文件因现有测试直接读取而保留为遗留 fixture，无生产加载引用。
- [x] 更新 Server 重建触发和开发/发布部署路径，保证扩展-only 修改也不会复用旧二进制。

检查点：三个环境的加载路径是实际 Pi 所在环境的绝对路径；旧通用源码接口可兼容，内置迁移不回到临时文件。

## 3. Host 共享设置

- [x] typed SQLite 配置：按 Connection 保存 enabled 与 nullable model，默认关闭/跟随当前；幂等 schema，Connection 删除时清理。
- [x] 在 Application/Host service 统一读取/保存及校验；Tauri 与认证后的 HTTP 仅做 transport，不在 Command 中复制业务。
- [x] 更新 PiloClient、desktop/web adapters、共享类型和设置变化事件；事件只在持久化成功后发送。
- [x] 重连/重放路径重新读取权威配置；Local Pi/SSH 工作区选模型按实际 runtime 目录解析，不误用远端模型。
- [x] 桌面与 WebUI 使用同一预测设置组件，浏览器有可用入口，不照搬整个桌面设置框。

检查点：切换开关不丢模型选择，无跨供应商确认弹窗，未开启不产生预测调用。

## 4. 预测扩展与请求管理

- [x] 增加单文件 next-prompt，内嵌 Claude 风格 prompt 与归属说明；不复制 TUI editor，不加入独立 prompt/manifest 文件。
- [x] 有限当前分支上下文提取、摘要和工具状态，不读额外代码文件，不传 thinking/完整工具内容。
- [x] 使用 Pi modelRegistry 独立 complete，不 setModel、不 sendMessage；明确模型不可用不静默换目标。
- [x] 生成/取消命令、短输出预算、超时、AbortController、Session/leaf/模型与请求关联检查；不自动重试。
- [x] Host 只向已有 Pi 进程转发预测并注入保存的配置；不能调用 ensure 为预测启动 idle Session。
- [x] setWidget 专用命名空间结果，null 为正常无建议；共享类型与 decoder 验证，结果不进 conversation/DB。
- [x] 同一结束的多客户端请求合并实际调用，cancel 与 requestId 对应，避免互相取消或重复费用。

检查点：失败不致命，不新增主对话消息或 token/cost 统计消息，不记录预测正文和凭据。

## 5. 共享 Ghost Text 与两端接入

- [x] 实时完整结束触发，共享预测状态 hook；不因历史读取、重放、再次聚焦或 state 刷新补发。
- [x] 统一处理 active/idle/draft/images/dialog/readOnly/enabled 条件以及会话运行、草稿、配置修改代次。
- [x] 桌面和 WebUI transport 接入同一解析和生命周期逻辑，Composer 接收独立预测 prop，不混入命令补全。
- [x] Tab 只在无 modifier、非 IME、空输入且有效建议时接受；补全优先，无建议保持焦点行为。Esc/输入/提交/切换立即失效。
- [x] 触屏采用按钮和可访问名称、窄屏排版、safe-area/keyboard inset；采用只写草稿，沿用原提交管道。
- [x] 设置/模型不可用显示轻量状态，无建议静默，避免每轮 toast。

## 6. 检查与验证计划

先执行静态代码/diff 阅读，核对 PRD AC1–AC11、所有消费者和新增字段。加载 trellis-check；不得因技能建议而越过测试/构建授权限制。

用户明确授权验证后，按改动范围执行：

```bash
pnpm format
pnpm check
pnpm build
cargo fmt --all --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
```

若用户另行授权运行现有测试，再选择相关 SSH/model/session/composer 测试或现有 unit suite；不新增测试文件。pnpm format 可能修改范围外文件，审查并避免纳入无关变化。

GUI 验证需授权且分平台：Windows 侧 `pnpm tauri dev` 验证桌面；WebUI 在浏览器验证，含触屏与软键盘。WSL 不代替 Windows 桌面/安装包验证。Local/WSL/SSH 的 Server 部署验证同样待授权。

重点场景：

1. 默认关闭、开启/关闭、跟随模型/指定模型、跨两端与重连同步、不同 Connection 隔离。
2. 单次完整结束、后台会话、排队 follow-up、retry/compaction、历史重放不触发重复预测。
3. 模型响应延迟期间输入/附件/Esc/提交/切换/fork/修改设置；迟到结果始终丢弃。
4. Tab 补全与焦点、中文组合输入、移动端点按不发送、窄屏和安全区。
5. 配置模型不存在/无凭据/超时/null/非法输出不影响主聊天，不增加会话消息。
6. Server 首次部署、复用、扩展缺失补齐、开发改扩展后重部署、三个环境固定路径和按需加载。
7. 两个 SSH Session 的动态配置隔离，Local Pi/SSH 运行环境模型目录正确；多个客户端同一结束不重复实际调用。

## 7. 完成与回退

- [x] 回读本任务源码与 diff，记录实际检查、未授权/未执行的验证及兼容限制；不声称未运行的测试通过。
- [x] 同步 backend/frontend 规范索引及 next-prompt-and-extensions 契约。
- [x] 获得代码检查/构建授权并执行；完整 pnpm check 最终通过。
- [x] 获得任务外 scripts/dev.mjs 仅格式化的批准，重跑完整 pnpm check 通过。
- [ ] 提交需另外批准；真实功能/跨环境验证仍未执行。
- [ ] 任务完成后再处理归档与日志，创建任务时不归档、不启动实施。

功能回退是按 Connection 关闭预测。固定部署和内置迁移出现问题时回退对应代码，不删 Pi JSONL/用户配置，不用临时内置脚本掩盖部署问题。

## 实际检查记录

- 已静态阅读全部新增模块、受影响调用者和数据流；本机 Pi 1.2.0 声明/实现确认 modelRegistry.complete/find/hasConfiguredAuth、buildSessionProjection、agent_settled.aborted、session_before_*、RPC setWidget 与 maxTokens/signal/maxRetries。未臆造 reasoning 参数或事件回退。
- 范围内 `pnpm exec oxfmt --write <changed TS/TSX/JS>` 与 `rustfmt --edition 2024 --config skip_children=true <changed Rust>` 已执行；`git diff --check` 已执行且无错误。它们不等于类型、lint、运行或部署验证。
- 扩展就绪握手防止加载失败时控制命令污染主对话；独立 RPC ID 不占主回合标记；预测 transport send 限时 2 秒。
- 静态审查补齐 pending Esc 取消、HTTP LAN requestId 兼容、设置保存开始即失效、转义后 JSON 预算和原子部署暂存文件 nonce。
- 未新增/修改测试，未运行测试、GUI 或 Local/WSL/SSH 环境验证。AC1–AC11 的运行场景均需实际验证后才能标记通过。
- `chat-activity.tsx` 的任务外改动保持原样；`scripts/dev.mjs` 经用户另行批准只做格式化，其原有业务改动仍不属于本任务。旧 `pi_ssh_workspace.js` 保留给未改动的现有测试；新部署文件还需独立运行验证。
- 未提交、推送或归档；任务保持 in_progress。

### 本轮已授权的代码检查/构建

- `pnpm check`：失败于全仓库 oxfmt 检查，唯一格式问题为任务外 `scripts/dev.mjs`；此时 lint/build 尚未运行，随后单独执行。未为通过检查擅改任务外文件。
- `pnpm lint`：初次发现本任务 ref 写入时机、effect 依赖、输出可访问性和迁出内联模板后的 JS lint 问题；修复后通过。ref 改在 layout effect 更新，Web handler 以稳定 callback 绑定；模型探测保持必需的串行切换，并注明不能并行。
- `pnpm build`：TypeScript 与桌面/WebUI Vite + PWA 构建通过，修复 lint 后已重跑通过。
- `cargo fmt --all --check`、`cargo check`、`cargo clippy --all-targets --all-features -- -D warnings`：通过；扩展 JS 修改后已重跑。另 `cargo check --workspace` 与 `cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过，覆盖 Server/Protocol 自身 targets。Clippy 编译 targets 不代表执行测试。
- 本任务 23 个 TS/TSX/JS 文件 scoped `oxfmt --check` 与最终 `git diff --check` 通过，tests diff 为空。
- 用户另行批准仅格式化 `scripts/dev.mjs`，已执行 scoped oxfmt；随后完整 `pnpm check` 与 `git diff --check` 通过。格式化只调整 spawnSync 调用换行，保留原业务逻辑。真实功能/跨环境验证仍待授权，未提交。

## 验收记录（2026-10-14）

本节晚于上面的过程记录，以本节为最终验收结论。

### 本机自动验收（macOS，只读）

| 检查 | 结果 |
| --- | --- |
| `pnpm check`（oxfmt --check + oxlint --deny-warnings） | 通过：379 文件格式正确，lint 无告警 |
| `pnpm build`（tsc + Vite 桌面/WebUI + PWA + sw） | 通过 |
| `cargo fmt --all --check` | 通过 |
| `cargo check --workspace` | 通过 |
| `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 通过 |
| `pnpm test:unit` | 通过：175 passed / 0 failed |
| `cargo test --workspace` | 通过：138 passed / 0 failed |

### 单元测试覆盖

本任务未新增测试，`tests/` 下无针对预测或内置扩展部署的用例；验收依据为上述检查链与运行验收。

### 运行验收（用户确认）

用户确认已完成运行验收，包括桌面与 WebUI 的预测交互、以及 Local / WSL / SSH 三环境的内置扩展实际部署。PRD 的 AC1–AC11 全部通过。

### 与验收项的对应

- AC1–AC4（预测内容、默认关闭与设置共享、跨端同步与 Connection 隔离、关闭后不发起与迟到结果丢弃）：运行验收覆盖。
- AC5–AC8（单次调用与后台生成、Tab/触屏采用与输入不回归、切会话/fork/设置变化后旧结果不出现、失败不阻塞主聊天）：运行验收覆盖。
- AC9–AC10（固定部署与复用、缺失补齐、不保留临时源码路径；Local/WSL/SSH 按需加载与两 SSH Session 隔离）：由 Local / WSL / SSH 实际部署验收覆盖。
- AC11（桌面与 WebUI 均可配置使用、窄屏入口与 Ghost Text 不遮挡）：运行验收覆盖。
