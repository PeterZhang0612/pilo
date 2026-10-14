# Implementation Plan

## Preconditions

- [x] 用户明确要求创建 Trellis 任务。
- [x] 需求、方案和源码证据写入 prd.md / design.md / research/codebase.md。
- [x] 用户确认移动窄屏只使用 Scope、桌面布局提供编辑。
- [x] 用户在阅读包含移动端调整的最新最终方案后明确确认开始实现。
- [x] 确认后执行 task.py start 10-12-project-model-scope --allow-empty-context。
- [x] 开始编辑前加载 trellis-before-dev 与对应 frontend/backend specs。

Sub-agents disabled；不创建实施子代理，不需要填充空 jsonl manifests。

## 1. Persist Project Preferences

- [x] 在 domain 增加强类型的项目 Scope 及模型引用；字段区分 null 与 []，保留明确 thinkingLevel。
- [x] 添加幂等 project_model_scopes 建表与 FK cascade。
- [x] 在 storage 增加查询、一次性替换与恢复继承的操作；项目不存在时报错，重复模型身份拒绝。
- [x] 添加共享 runtime/application 保存逻辑；保存先成功再发布项目级事件。
- [x] 保持 project_model_cache 的 Pi 默认模型与 Scope 元数据不变。

预计受影响：src-tauri/src/domain/、runtime/storage/schema.rs、runtime/storage/projects.rs、runtime/events/model.rs，以及单独的 scope capability 模块（如需要）。

检查点：默认无设置 -> 继承；[] -> 自定义空；删除项目 -> cascade；目录刷新不能覆盖偏好；失败没有部分写入。

## 2. Expose Both Transports

- [x] 添加薄 Tauri get/set commands 并注册。
- [x] 在 Remote 认证路由增加项目 Scope GET/POST，复用同一保存逻辑；不开放通用配置写接口。
- [x] 扩展 PiloClient，分别实现 TauriPiloClient / WebPiloClient。
- [x] 增加事件 TS 类型与消费者，项目设置事件在当前会话过滤前处理。
- [x] 读取、事件、提交采用 request identity/更新时间，防止项目切换和过期请求覆盖较新设置。
- [x] reconnect/resync 能重新获取偏好，不依赖浏览器自己启动 Pi probe。

预计受影响：src-tauri/src/runtime/commands/projects.rs、commands/mod.rs、src-tauri/src/lib.rs、runtime/remote/api/{mod,handlers}.rs、src/lib/{pilo-client,tauri-pilo-client,pi-runtime-types}.ts、src/remote/{remote-client,web-pilo-client,use-remote-chat-transport}.ts。

检查点：桌面/WebUI 指向同一数据库；错误/空值/继承语义一致；保存不转发 Pi RPC。

## 3. Compute the Effective Scope

- [x] 将项目 Scope 类型和唯一的有效列表计算放在共享 lib 模块，复用 piModelsMatch 与既有思考等级 helpers。
- [x] 继承使用 Pi 默认元数据与原有顺序；无 Pi Scope 时使用全部可用模型。
- [x] 自定义列表按存储顺序匹配 available catalog；空列表不回退，暂时不可用成员不参与选择/轮切。
- [x] 桌面与远程 controllers 分别保留 catalog 和 preference；WebUI live models 不再丢掉 Host 缓存的默认 Scope 元数据。
- [x] Scope 快捷键使用同一有效列表，并经 set_model / set_thinking_level 应用；保留全部模型快捷键行为。
- [x] 保留历史配置的延迟应用及临时会话行为；不因保存 Scope 启动、重启或中止 Pi。

预计受影响：src/lib/pi-model-selection.ts、src/components/chat/use-chat-session-config.ts、use-chat-model-shortcuts.ts、src/remote/use-remote-chat-agent-config.ts 及其调用方。

检查点：继承/custom 空/custom 非空、同 ID 不同 provider、不可用模型、明确 thinking override、正在运行时提交。

## 4. Shared Picker and Draft Editor

- [x] 提取共享模型 picker/editor，接入 ChatComposer 与 ComposerRunConfig 的 desktop/touch 两种容器。
- [x] 模型名称/ID/provider 搜索与全部/Scope 切换；加载/错误/空结果的文案。
- [x] 各端显示继承/项目自定义来源；桌面应用与桌面布局 WebUI 显示管理入口，通过 canEditScope 控制，移动窄屏不显示编辑/批量操作/恢复继承。
- [x] 编辑从有效列表初始化，多选、全选搜索结果、清空只更新草稿；取消勾选不立即隐藏行。
- [x] 应用一次保存整个列表；关闭/取消丢弃；未修改不创建覆盖。
- [x] 恢复继承与清空分开；提交失败保留草稿；提交中防重复操作。
- [x] 处理不可用的已配置成员，不在批量操作中静默丢弃。
- [x] 复用现有 UI primitives，桌面使用适合输入框的 focus 容器，触屏保留 sheet/safe-area。
- [x] 新增 zh-CN / en-US 文案，检查键盘导航与辅助技术状态。
- [x] 适配软键盘 viewport，必要时扩展现有 mobile inset 的 CSS contract，不复制 WebUI 组件。

预计受影响：src/components/chat/chat-composer-run-config.tsx、chat-composer.tsx、chat-page.tsx、src/components/new-chat-landing.tsx、新共享 picker/editor、src/remote/remote-app.tsx、src/i18n/resources/。

检查点：桌面继承五个 -> 编辑仍选五个 -> 多次操作正式列表不变 -> 一次应用；取消不变。移动端只有搜索、视图切换与模型选择，能同步桌面保存结果；软键盘不遮挡搜索和模型选择。

## 5. Full-Scope Review

- [x] 加载 trellis-check，复查完整 diff、类型边界、调用方和跨层数据流。
- [x] 搜索确认不存在新增 Pi 配置写入、pilo-server scope bridge、上游私有 API 或 Pi 重启逻辑。
- [x] 确认 source catalog 不被有效 Scope 投影覆盖，偏好保存不改变目录 TTL。
- [x] 确认桌面与 WebUI 同步，编辑草稿不被事件刷新覆盖。
- [x] 复查请求失败、重复提交、项目切换、无缓存、[] 与 null。
- [x] 根据新项目偏好/事件契约更新 frontend/backend specs；先加载 trellis-update-spec。

## 6. Verification / Commit

当前未获运行测试、构建或 GUI 验证的授权。以下是待授权的验证计划，不在 planning 中执行：

```bash
pnpm format
pnpm check
pnpm build
cargo fmt --all --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
```

- 测试文件不自动新增或修改；用户明确要求测试时才补针对有效 Scope 与存储的用例。
- 现有单元测试仅在获授权后运行。
- 桌面 GUI 使用 Windows 侧 pnpm tauri dev；桌面浏览器验证 Scope 管理，移动窄屏/触屏/软键盘验证搜索、模型选择、设置同步及管理入口隐藏。
- 用户未授权的验证明确报告为未执行，不将源码阅读描述成运行验证。
- git commit 需要单独确认，不自动提交或推送。

## Rollback Points

- 存储/transport 与 UI 分阶段检查，尚未接入 UI 时不得改变既有模型选择行为。
- 发现 Pi 默认 Scope 与项目覆盖混写时停止，回到 design 修改；不可通过覆写 cache 字段绕过。
- 发现必须修改 Pi 配置、启动 WebUI probe 或重启 Pi 才能生效时停止，重新审查方案。
- 回滚保留用户新表数据；不删除或迁移 Pi 配置、会话和 conversation。

## Implementation Status

- 本次用户已明确授权开始实现，任务已通过 task.py start 激活；不创建分支、不提交或推送。
- 存储、双 transport、项目级事件、有效 Scope 投影、共享搜索与桌面草稿编辑已实现。全部轮切保留原列表，Scope 轮切在 Pilo 选目标后使用既有 set_model/set_thinking_level。
- 原始 Pi 目录与自定义偏好分离；WebUI 先按 Host 目录解析继承 Scope，再匹配 live 可用成员。旧/未解析目录不会误当作全部模型默认 Scope。
- 请求身份、读取序号与单调更新时间处理过期响应；项目事件不走 sessionKey/generation 过滤，正式设置更新不覆盖编辑草稿。
- 已复查完整源码差异、调用方与跨层契约，并更新 frontend/backend spec 索引及项目 Scope 契约。
- 已执行修改文件的 oxfmt 格式化、cargo fmt --all 与 git diff --check；尚未执行 lint、type-check、测试、构建或 Windows/浏览器 GUI 验证。实现清单表示源码已接入，不表示动态验收已通过。
- 根据用户反馈纠正桌面样式：恢复“模型 / 推理等级”两级 DropdownMenu，推理等级恢复原有子菜单；模型子面板复用 compact picker，保留搜索/Scope，移动端抽屉保持不变。键盘输入不交给菜单 typeahead，Tab 在模型面板内循环。
- 桌面根触发器已恢复真实 DropdownMenu 的 aria-haspopup=menu，tests/chat-composer-run-config.test.ts 的既有断言无需因此调整。未修改或运行测试；键盘、悬停、保存失败与草稿保留仍待动态验证。
- 根据后续反馈统一全部/Scope 的加载状态与面板风格：桌面 Scope 从同步更新的 React 原始目录 snapshot 派生；缓存后台刷新也标记 loading，自定义 Scope 不依赖默认元数据。WebUI 单独记录可用列表是否已加载，保持继承元数据约束。
- picker key 使用稳定 projectId，首次偏好响应不重挂组件；刷新前聚焦搜索，避免刷新按钮禁用导致子菜单关闭。hydrate 回调与历史刷新请求增加过期保护；未改变草稿提交算法。
- 桌面主菜单向上展开并保留 8px 间距；模型/推理子面板保持底边对齐，相比零偏移下移 24px，保留 16px collision padding。搜索、视图切换和勾选复用现有 primitives；触屏 sheet 的安全区与软键盘规则保留。
- 只读运行环境排查：两个 WSL 项目缓存均有 8 个模型、4 个 Scope 成员，默认元数据完整；探测扩展响应成功。未发现当前 WSL server 缺少 Scope 数据的证据，未修改或更新 server。详见 research/codebase.md；尚未确认实际窗口已消费新快照。
- 再次反馈未加载后，通过当前 Windows 窗口已启用的 WebDriver 只读检查 React props：当前入口是 NewChatLanding，全部模型为 8 个，但传给 ComposerRunConfig 的 modelScope 为 undefined。根因是遗漏落地页调用方，不是缺失目录元数据；先前缓存/状态修复没有覆盖用户实际入口。
- 已在 NewChatLanding 接入共享项目偏好 hook、项目事件订阅、目录 snapshot、有效 Scope、桌面编辑和 Scope 快捷键；旧项目 hydrate 回调有失效保护，刷新复用 loading/error 状态。加载占位 composer 禁用未接入的管理入口。
- 修改后只读检查同一运行窗口：全部/可用列表均 8 个，Scope 4 个，catalogReady=true，scope 为继承 Pi，loading=false、error=null。未点击菜单、执行提交或修改 Pi 配置；未验证完整菜单交互、跨端编辑、测试或构建。两处修改文件的 oxfmt 与 git diff --check 已通过。
- 后续先获授权执行验证，再准备提交计划；验证/提交前保持 in_progress，不归档。

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

- `tests/pi-model-selection.test.ts`：Scope 顺序优先轮切、无 Scope 时回退全部模型、Scope 内推理等级、只暴露所选模型 profile 的推理等级。
- `tests/chat-composer-run-config.test.ts`：桌面触发器保留 DropdownMenuTrigger 合并 props、disabled 状态、显示所选模型与推理等级。
- `tests/project-draft-cache.test.ts`：草稿缓存相关行为。

### 运行验收（用户确认）

用户确认已在 Windows 桌面、手机 WebUI 及真实 Local / WSL / SSH 环境完成运行验收，PRD 的 14 条验收项全部通过。

### 与验收项的对应

- 搜索、Scope 视图与 Pi 默认解析一致、草稿式批量编辑、取消/关闭不落库、保存失败保留原 Scope、清空与恢复继承、Scope 快捷键：由单元测试与运行验收共同覆盖。
- 编辑 Scope 不重启 Pi、不修改当前模型、不干扰流式响应；跨重启/跨会话持久化；桌面与桌面布局 WebUI 编辑同一 Host、移动端只读且不显示管理入口；不写 Pi 配置：由运行验收覆盖。
