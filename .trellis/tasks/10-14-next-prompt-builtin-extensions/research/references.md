# 研究依据与讨论结论

## 已核对的公开参考

本会话通过 exa 获取 GitHub 页面和官方文档，通过 GitHub API/raw 源码阅读实现；grep MCP 对 pi-next-cue 的检索没有结果，后改为直接阅读该仓库源码。未安装参考扩展，未运行其测试。以下 URL 指向可变化的 main，不等于已固定依赖版本。

### Claude Prompt Suggestion Generator v2

https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/agent-prompt-prompt-suggestion-generator-v2.md

- 页面当时标注 ccVersion 2.1.132。
- 核心是预测用户会输入什么，而非推荐助手认为应该做什么；具体、短句、匹配风格，没有明确下一步时沉默。
- 错误、误解和安全敏感场景保持沉默，不引入新点子或多个句子。
- 英文 2–12 words 不宜机械套用中文。
- 该公开整理仓库 LICENSE 为 MIT，Copyright (c) 2025 Piebald LLC；复用时保留声明，不声称是官方独立产品/API。

### pi-next-cue

https://github.com/ouzhenkun/pi-next-cue
https://github.com/ouzhenkun/pi-next-cue/blob/main/index.ts

- 从当前 branch 提取最近 user/assistant 文本和工具状态，通过 ctx.modelRegistry.complete 调用模型，使用 AbortController。
- TUI editor 支持 Tab 填入、Enter 直接发送；Pilo 不继承这些编辑器代码或直接发送行为。
- session_start 有 ctx.mode !== tui 的展示限制。
- 原提示词要求始终给具体建议，薄上下文也输出 ok/continue，与本任务 Claude 策略冲突，明确不用。
- 它的 corrections 把没有使用建议视为纠正；本任务首版不做此类学习。

### next-prompt

https://github.com/gamaraan/next-prompt-extension
https://github.com/gamaraan/next-prompt-extension/blob/main/next-prompt.ts

- 借鉴请求 generation、AbortController、输出校验、上下文预算、真正 settled 后计算。
- TUI/RPC 限制使其不能直接作为 Pilo 扩展安装使用。
- 跨目标识别不只是 provider 名称，endpoint 和模型路由也影响发送目的地。
- 用户明确选择不采用它的逐目标确认流程，Pilo 设置即授权；内容最小化仍保留。
- README 的 reasoning 参数描述与实际源码可能不同，实施必须核对当前 Pi API。

### pi-chat-suggest

https://github.com/sanif/pi-chat-suggest
https://github.com/sanif/pi-chat-suggest/blob/main/suggestions.ts

- 可参考取消、cache、当前分支/摘要提取和补全优先级。
- 多候选、草稿补全、独立 prompt/config 文件和 TUI 编辑器均不是首版需求，不整体移植。

### 官方 RPC 和 Packages

https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/rpc-demo.ts
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-mode.ts
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts
https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md

- RPC setWidget 仅转发 string[]/undefined，不支持 TUI component factory；事件 method 为 setWidget，setEditorText 的事件 method 为 set_editor_text。
- RPC getEditorText 同步返回空字符串，不能判断 React 草稿；编辑器状态必须由 Pilo 决定。
- pi.events.emit 是扩展间事件，不自动作为 RPC 自定义事件传给客户端。
- 注册 extension command 可由 prompt 调用，不作为普通 Agent 用户回合；应保持后台预测与 conversation 分离。
- agent_settled 是完整结束；agent_end 可能后接重试/压缩/队列继续。
- 单个 .js/.ts 文件可通过 -e/--extension 显式加载，不必须做 Package。
- pi config 是交互式 TUI，不能直接当图形界面的机器 API；第三方扩展具有完整系统权限。

## Pilo 代码证据

- `crates/pilo-server/src/runtime_streams/pi.rs:181`、`:249`、`:389`：extensions 是内联源码，内容寻址的临时 .js，显式 --extension 加载。
- `src-tauri/src/runtime/server_deploy.rs:13`、`:43`：远程固定根目录，Local dev 内嵌 Server 与 Local release 二进制入口不同。
- `src-tauri/src/runtime/server_deploy/target.rs`：Local 安装资源路径，不保证可写。
- `crates/pilo-server/src/lib.rs:45`、`src/main.rs:7`：现有 Server 二进制 fingerprint。
- `src-tauri/src/runtime/pi_workspace.rs:55`、`pi_ssh_workspace.js:21`：SSH 内置脚本以源码常量和占位符替换配置，迁移要分离各进程配置。
- `src/lib/pi-model-catalog-extension.ts:21`、`src/lib/pi-models.ts:418`：模型探测目前发前端内联源码，迁移保留命令/结果语义。
- `src-tauri/src/runtime/chat_service.rs:32`、`remote/api/handlers.rs:437`：正常聊天两端都走 Host runtime profile，WebUI 不从请求注入 extensions。
- `src-tauri/src/runtime/pi_events/mod.rs:133`：assistant_message_end 是 agent_settled 的 typed 映射。
- `src-tauri/src/runtime/pi_event_adapters.rs:95`：Widget 字段已透传；两端处理器未消费 setWidget。
- `src/components/chat/use-chat-composer-input.ts:434`：已有补全 Tab 与 IME gate，预测必须保留其优先级。
- `src/components/settings/session-naming-settings.tsx`、`storage/schema.rs:66`：命名模型已有按 Connection 持久化模式，但该组件的 invoke 入口不能直接在 WebUI 使用。
- `src/lib/preferences-provider.tsx`：普通偏好是 localStorage，不满足本任务 Host 共享配置。
- `src/remote/remote-app.tsx`：WebUI 复用 ChatComposer，没有完整桌面 SettingsDialog，需最小共享预测设置入口。
- `.github/workflows/server-runtimes.yml`、`scripts/sync-to-windows.sh`：部署脚本/CI 路径过滤应包含迁入的扩展文件。

## 用户确认的决策顺序

1. Claude 提示词作为预测策略，功能可开关、模型可配置。
2. 扩展与 Server 共用 Runtime 根目录，不采用 bundle-hash。
3. 无第三方依赖时采用单文件，其他 Pilo 内置扩展统一放 extensions/，不做 Package。
4. 开关和预测模型按 Connection 保存，两端共享。
5. 默认关闭；开启后未指定预测模型则跟随主模型，可指定目标。
6. 空输入框一句预测，Tab/触屏采用只填入；输入/Esc 隐藏，不自动发送。
7. 不要授权提示，设置之后直接允许发送裁剪上下文。
8. 创建任务当时未批准实施；后续用户已批准实现并多次要求继续。测试、构建和 GUI 验证仍未获明确授权。

## 研究限制

- 没有验证任何桌面、浏览器或远程环境；参考源码仅静态阅读。
- 没有统一锁定各 Connection 的 Pi 版本，实施前核对可用 API；不可用时禁用预测而不是冒险回退触发事件。
- fastcontext MCP 在工具发现中未提供，项目检索使用路径搜索与 rg。

## 实施期补充（静态核对，非运行验证）

- 本机 Pi Coding Agent 1.2.0 的 API 声明与实现确认：modelRegistry.complete/find/hasConfiguredAuth、SessionManager.buildSessionProjection、RPC setWidget、agent_settled.aborted、session_before_switch/fork/tree。Pi-ai StreamOptions 明确提供 signal/maxTokens/maxRetries；未使用猜测的统一关闭 reasoning 字段。
- 预测以 Session projection 而非 raw branch message list 构造材料，保留 compaction/context-edit 语义；getBranch 仅用于检查最后 assistant 结束状态。
- API readiness 在 session_start 通过私有 Widget 宣告，Host 没收到 ready 不发送私有命令。原生 RPC command 被实际注册后才安全作为非普通对话请求。
- HTTP LAN 上 crypto.randomUUID 可能缺失，相关请求复用项目 randomId；它只是关联 ID，不是授权证明。
- 旧 SSH 测试直接导入旧路径并替换占位符，用户要求不改测试，因此原源文件保留为 fixture；新 Server 源文件走环境配置，旧文件不再有生产引用。
- Windows 同步脚本纳入扩展 .js 的 freshness；CI 的 crates/pilo-server/** 已覆盖资源变化，无需另增发布工作流或独立扩展清单。
