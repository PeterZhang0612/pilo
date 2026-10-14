# 技术设计

## 1. 边界

本任务是一个完整的输入辅助能力：固定部署的预测扩展、Host 持久化配置、RPC 请求管理、共享输入框展示必须一起覆盖。现有内置扩展迁移是同一部署机制的直接使用者，不另建插件平台。

- Host 管理 Connection 设置和授权后的调用入口。
- pilo-server 管理固定扩展资源及实际 Pi 进程。
- Pi 扩展读取 Session 分支并通过 Pi modelRegistry 调用模型。
- React 管理真实草稿状态和采用交互，不读取系统文件，不直接使用模型凭据。
- 桌面和 WebUI 是同一 Host 的两种 transport，不分别维护权威设置。

## 2. 源码与 Runtime 布局

统一使用现有可直接由 Pi 加载的 plain ESM JavaScript，避免引入新的 TypeScript 编译或依赖安装链：

```text
crates/pilo-server/extensions/
  next-prompt.js
  ssh-workspace.js
  model-catalog.js
```

预测提示词与必要来源/许可说明内嵌于 next-prompt.js。引用开源实现时保留必要 MIT 声明；不以减少文件为由删去归属信息。

部署后：

```text
<runtime-root>/
  pilo-server[.exe]
  extensions/
    next-prompt.js
    ssh-workspace.js
    model-catalog.js
```

WSL/SSH 沿用 `~/.cache/pilo/server/` 根目录。Local 使用可写的用户 Runtime 数据目录，而不是默认向安装目录写文件；开发内嵌 Server 不根据桌面可执行文件位置推断可写目录。Runtime 根路径由启动方显式提供，Server 启动入口同时支持独立二进制和桌面 `--pilo-server` 模式。

内置扩展以 include_str!/include_bytes! 等现有 Rust 资源方式随 Server 携带。Server 首次启动或文件内容变化时写入固定位置，缺失时补齐；不在每次 Pi Session 启动时生成源码。使用同目录暂存和原子替换确保完整文件，这是部署更新手段，不是每个 Session 的临时扩展加载路径。不要使用版本/哈希子目录，也不新增独立扩展版本清单。

WSL/SSH 继续传 Server 二进制，扩展由接收端 Server 部署。内嵌资源的改变应进入 Server 二进制指纹；开发脚本和 CI 需要将扩展源码纳入 Server 重建触发范围。检查现有 `scripts/sync-to-windows.sh`、Server build 脚本和 server-runtimes workflow 的路径过滤，不能只改 Rust include 后忽略部署脚本缓存。

## 3. 加载兼容与迁移

现有 PiStartParams.extensions 是源码字符串数组，不能直接将其改成文件路径数组。增加独立、类型明确的内置扩展选择和进程专属配置字段，由 Server 将允许的内置 ID 映射为自己管理的绝对文件路径，再追加 `--extension`。不接受任意浏览器提供的扩展源码作为本功能部署来源。

- 聊天运行环境 profile 选择 next-prompt（仅 RPC 支持的正常聊天）。关闭功能不执行预测，即使脚本已加载。
- Local Pi 操作 SSH 工作区时额外选择 ssh-workspace，保留禁用内置工具/自动资源发现/上下文文件的既有行为。显式扩展路径仍必须可加载。
- 模型目录探测选择 model-catalog，不选择 next-prompt，保留 throwaway/no-session 行为。
- SSH 配置从 `__PILO_SSH_WORKSPACE_CONFIG__` 的源码替换改为各 Pi 子进程的专属环境变量，例如 `PILO_SSH_WORKSPACE_CONFIG` JSON；验证配置、避免记录密钥，不修改共享扩展文件。
- model-catalog 保留当前命令和结果协议，前端不再传完整源码字符串。
- 通用内联源码入口如有其他调用者则保留兼容，但三个内置扩展不再走 materialize_extension。
- Pi 原生安装的用户扩展与现有发现规则不变，不复制或删除 ~/.pi/agent 下的资源。

## 4. Connection 配置

新增专用 SQLite 配置表，遵循已有 connection_naming_models 的 typed storage 与幂等建表模式，不扩大 connections 通用配置结构：

```text
connection_next_prompt_settings
  connection_id (Connection 标识，唯一)
  enabled
  provider NULL
  model_id NULL
  updated_at_ms
```

传输类型：

```text
{ connectionId, enabled, model: null | { provider, id } }
```

- 缺少记录返回 disabled + model:null；model:null 表示跟随主模型，不表示关闭。
- provider/id 必须成对存在且非空；拒绝未知 Connection。保存失败保留旧配置，不能部分更新。
- 关闭只更新 enabled，不删除用户选择的模型。
- 删除 Connection 时清理关联配置；不修改 Pi settings.json。
- 设置的 key 是用户的项目 Connection；模型解析在实际 Pi runtime profile 对应环境执行。SSH 工作区使用 Local Pi 时，不用 SSH 主机的模型目录替代 Local 目录。
- 配置保存完成后广播专用配置变化事件，使桌面/WebUI 更新并取消旧预测；断线重连重新读取权威状态，不能依赖只收到增量事件。
- 实施时使用 Connection 配置的修改代次/不透明 revision 关联请求，不能只靠 enabled 判断旧模型结果。

通过 transport-neutral PiloClient 增加读取/保存入口，Tauri Command 和经过现有 require_auth 的 HTTP route 复用同一 Host service。新方法与 HTTP 名称是本任务新增契约，实施时沿用附近命名模式。

桌面设置复用现有紧凑 SettingsRow 和模型目录组件。WebUI 当前没有完整桌面设置界面；为当前 Connection 提供最小设置入口，复用同一个预测设置组件，不复制整套 SettingsDialog，也不直接复用 invoke-only 的 SessionNamingSettings。

设置文案说明预测会额外调用配置的模型并发送有限对话，不加确认弹窗。模型列表查询复用已有目录缓存/刷新能力，不新增供应商 SDK、密码表或预测专用模型发现进程。

## 5. 触发、请求与结果

```text
实时 assistant_message_end（由 agent_settled 映射）
  -> 共享状态检查 active/idle/草稿/附件/dialog/readOnly/enabled
  -> Host 预测入口读取当前配置、已有 Session 和运行代次
  -> 校验该 Pi 已通过预测扩展就绪握手
  -> 已运行 Pi 的 RPC prompt 调用 /pilo-next-prompt <JSON>
  -> 扩展验证 idle/Session，读取分支，开始独立 complete
  -> setWidget("pilo.next-prompt.v1", [JSON.stringify(result)])
  -> 现有 extension_ui_request 转发
  -> 共享 decoder 与当前请求校验
  -> ChatComposer Ghost Text
```

Host 入口不调用 ensure 来为预测启动 idle Pi；客户端只提供关联标识，模型选择由 Host 配置决定。Tauri 与 HTTP 请求进入同一应用 service，再复用现有 Pi RPC 写入能力。扩展命令被 Pi 立即处理，不作为普通用户消息持久化；handler 启动后台受控计算后尽快返回，不等待完整预测阻塞 RPC 确认。

请求最少包含 requestId、预期 sessionId 和配置 revision，Host/客户端上下文另外保留 sessionKey 与 Pi generation。扩展读取 leafId 作为分支快照并在结果发出前重验。

结果约定：

```text
{ requestId, sessionId, leafId: string | null, revision, text: string | null,
  status: "ready" | "empty" | "cancelled" | "unavailable" }
```

结果通过官方 setWidget 字符串数组通道发送，这是 Pilo 私有命名空间约定，不是 Pi 新增的通用自定义 RPC 事件。`text:null` 是合法“无建议”，和异常状态区分。仅处理 method=setWidget 且 widgetKey 精确匹配的消息，不把任意 Widget 当成预测。

现有 RuntimeEvent 的 Widget 字段已足够，不新增 conversation 事件。共享 decoder 从 unknown 验证单个 JSON、类型、字段长度和正文上限，桌面/WebUI 不分别 cast 或解析。建议最多一行短句，出现多句解释、代码块或异常长度时丢弃，不截成改变含义的指令。

触发只消费当前活动视图的实时最终结束事件，不在读取历史、挂载、事件重放、普通 session state 刷新或再次聚焦时补发。一次完整结束按会话运行代次关联，不能每个工具轮次触发。多客户端看到同一结束时，扩展/Host 按实际 Session 分支完成位置、模型和配置修订合并实际调用，必要时将同一结果绑定到各有效 requestId；不为此实现通用租约框架。

## 6. 生命周期与失败

前端记录 requestId + sessionKey + Pi generation + draft revision + config revision。任何输入、附件变化、提交、Esc、会话/fork/模型切换、禁用、进程退出、阻塞 UI 或断线都立即使显示结果无效，再尽力发送 cancel。cancel 只能影响对应请求，不能用广播取消干扰另一客户端。

扩展使用 AbortController；新一轮运行、会话替换、卸载、模型变化和超时取消。响应前同时确认 signal 未取消、Session/branch 仍匹配、模型配置仍对应该请求。前端还有独立校验，即使网络 cancel 迟到也不能重新显示。

模型解析通过 ctx.modelRegistry，使用用户指定目标或当前 ctx.model；检查认证可用性，显式指定但不可用时停用本次预测，不静默 fallback，也不调用 pi.setModel。默认采用约 10,000 字符输入预算、128 token 短输出预算、约 5 秒超时，支持时降低/关闭推理；具体 Pi 参数按已安装版本声明核对，不盲信 README 字段。

预测失败不自动重试，不产生致命 runtime_error 或聊天气泡。配置/模型不支持时在设置处显示轻量状态，不每轮弹 toast；无建议直接不显示。取消不能保证供应商零费用。

## 7. 上下文与 Prompt

读取 ctx.sessionManager 当前分支，优先保存当前任务原始意图、最近用户/助手文本和最后回复；压缩后使用已有摘要而不是重新读取仓库或完整 JSONL。工具只保留名称和成功/失败状态，不发工具输出正文、参数、thinking 或附件。

Claude 提示词内嵌，核心规则保持：预测用户会输入什么、不引入新任务、具体短句、用户语言/风格、下一步不明确时沉默、安全敏感/错误/误解时沉默；对中文使用短句表达，不机械按英文空格字数校验。上下文是预测材料，不是给预测器执行的指令。不存在为了“总有一条”而回退成 ok/continue 的规则。

用户已明确选择设置即授权，不实现 next-prompt 的跨供应商确认弹窗；该简化不改变内容最小化或日志隐私约束。日志只记录 requestId、状态、耗时等元信息，不能记录输入材料、输出正文、凭据或完整 SSH 配置。

## 8. 共享输入框

ChatComposer 接收单独的预测 prop 和 adopt/dismiss 回调，不混入现有命令/文件 ComposerSuggestion 列表。真实 textarea value 在用户采用前保持不变，Ghost Text 不是草稿也不触发提交。

按键优先级保留当前补全处理，只有纯 Tab、无 modifier、非 IME、空草稿且有效预测时才 preventDefault 并采用；其他情况下恢复默认 Tab 焦点导航。Esc 隐藏当前预测且不影响既有优先级。历史导航不得把 Ghost Text 当输入历史。

触屏展示可访问的点按入口，窄屏文字可换行，触控目标足够大，使用现有 composer frame 的 safe-area/keyboard inset；不复制 WebUI 专用输入框，不改变 viewport 或键盘整体策略。

## 9. 发布、兼容与回退

配置表与 Server 请求字段采用 additive 变更；更新所有正常聊天、模型探测、parallel/profile 和开发内嵌 Server 调用者，避免只迁移桌面可见路径。新增 RPC 字段必须有兼容默认值，旧内联入口保留到确认无其他调用者。

固定目录不保证正在运行 Pi 的动态依赖重新加载一致性，不承诺热更新或独立回滚。更新仅按现有 Server 生命周期替换文件，新扩展代码以重新启动 Pi 为生效条件；更新失败不得加载半写文件。关闭预测是功能回退入口，正常聊天、SSH 工具和模型目录探测必须继续可用。

各运行环境 Pi API 可不同。实施前核对 agent_settled、modelRegistry.complete 和 Widget API；不支持时禁用预测并说明，不以 agent_end 猜测完整结束。未知参数或凭据问题不触发额外供应商请求。

## 10. 实施补充

- 就绪握手为 `setWidget("pilo.next-prompt.ready.v1", ["ready"])`，不支持所需 API 时为 unavailable。Host 未确认当前 process readiness 时不发送私有 prompt；进程非 Running 状态转换清除 readiness。预测 RPC ID 与主回合 ID 独立，发送路径不触碰 active-turn 或 idle-retention 标记。
- 实际 generate/cancel 使用同一命令 `/pilo-next-prompt <JSON>`，cancel 是布尔字段而非子命令。Host 模型配置按原项目 Connection 解析，设置 revision 使用单次 UPSERT 的 `MAX(now, previous + 1)`。
- Ghost Text 复用原生 textarea placeholder，真实 value 仍为空；采用按钮与无 modifier/非 IME 的 Tab 只填入草稿。Esc 对已显示与仍 pending 的预测都有效。
- 设置复用共享 fields + Select，模型来自 Host 缓存，不为设置启动 probe。桌面全 Connection 设置页和两端 composer popover 复用字段组件。
- 原 SSH 源文件保留为现有源码读取测试的兼容 fixture，生产仅加载 Server 固定文件；不改测试。新源码改用 child environment 配置，不能视为旧 fixture 运行测试已经覆盖新路径。
- 三个固定资源编译进 Server，暂存名包含 PID 与时间 nonce，同目录 sync/rename 后仅向 Pi 传固定 canonical 路径。当前实际契约见 `.trellis/spec/backend/next-prompt-and-extensions.md`。
