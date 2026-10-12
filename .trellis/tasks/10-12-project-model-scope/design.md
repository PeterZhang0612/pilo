# Technical Design

## Change Boundary

当前差距：模型选择器只展示完整列表，Scope 元数据仅用于快捷键；无搜索、项目覆盖或延迟提交的管理交互。

最小完整改动范围：Pilo 项目偏好存储、两个 transport adapter、共享模型选择器和 Scope 编辑、有效 Scope 计算及轮切。Pi 模型目录继续是供应商模型与 Pi 默认 Scope 的来源。

不修改 crates/pilo-server，不修改 Pi 配置或内部 Scope，不重新实现 Pi 的模型解析、认证和思考等级能力计算。只在 Pilo Scope 快捷键路径将选择逻辑改为有效项目列表，实际切换仍使用现有 set_model / set_thinking_level。

## 1. Source of Truth

两种数据独立保存，不能混写：

- Pi 模型目录：已有 project_model_cache 与 ProjectPiModels。scopeOrder / scopeThinkingLevel 保留 Pi 默认解析结果，不写入项目覆盖。
- 项目偏好：新 project_model_scopes 表，保存 Pilo 的自定义成员和更新时间；不是对 Pi 会话事实的副本。

SQLite 的“Pi JSONL 唯一事实来源”约束继续适用于会话内容；此处保存的是 Pilo 自有的项目偏好，沿用其他 app-owned 配置的存储模式。

有效 Scope 由一个纯函数负责计算，所有选择器和 Scope 快捷键复用：

```text
projectScope.models == null -> Pi 默认 Scope
projectScope.models == []   -> 自定义空 Scope
projectScope.models 非空   -> 按存储顺序匹配可用模型，不做 union
```

Pi 默认 Scope 使用已有 scopeOrder 排序；没有任何 scoped 成员时，保留 Pi 的“全部可用模型”默认行为。目录未知/尚未加载时不声称 Scope 已解析，禁用依赖该数据的操作。

不要复用 getPiQuickCycleModels 的“空列表回退全部”处理自定义列表。Scope 为空必须保持空，只有继承模式才允许 Pi 的默认 fallback。

## 2. Domain / Persistence Contract

提议的跨端类型：

```ts
type ProjectScopedModel = {
  provider: string;
  modelId: string;
  thinkingLevel: PiThinkingLevel | null;
};

type ProjectModelScope = {
  projectId: string;
  models: ProjectScopedModel[] | null;
  updatedAtMs: number;
};
```

- models 为 null 表示继承；数组为覆盖，空数组有效。
- thinkingLevel 保留从 Pi 默认成员复制出来的明确等级；新增模型使用 null，按模型现有默认等级解析。
- 使用 provider + modelId 判等，重复身份在保存边界拒绝；草稿操作按身份去重，不让批量添加产生重复。
- schema：project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE，models_json TEXT NULL，updated_at_ms INTEGER NOT NULL。
- 无行时返回继承状态；恢复继承可 upsert null，保留更新时间供客户端判断响应先后。
- 保存通过单次 upsert 原子替换；不循环提交单个模型。
- 校验项目存在、非空身份、合法思考等级与重复身份；不以“当前目录没有此模型”为由拒绝或自动清除已有偏好。
- 保存先成功写入再发布事件；失败不更新正式客户端状态。

## 3. Transport / Synchronization

扩展现有 PiloClient，而不是让 React 直接接触 Tauri：

```text
loadModelScope(projectId) -> ProjectModelScope
saveModelScope(projectId, models | null) -> ProjectModelScope
```

桌面入口：project_model_scope_get / project_model_scope_set，薄 Tauri command 委托共享 application/storage 实现。

WebUI 入口：认证后的 GET /api/v1/models/scope?projectId=... 与 POST /api/v1/models/scope（projectId、models）。复用同一业务实现、校验和 Pilo Host 数据库。不向 pi --mode rpc 转发设置命令，也不产生临时 Pi 探测进程。

保存成功发布 project_model_scope_changed 事件，携带完整 ProjectModelScope：

- 使用现有 RuntimeEventBus 同时通知桌面与 WebUI。
- 前端事件在 activeSessionKey 过滤之前处理，因为偏好是项目级而不是当前会话级。
- 保留 JSONL streaming / 现有 runtime event replay contract；新事件不包含 conversation 或 Pi 配置信息。
- 项目切换、菜单打开、WebUI reconnect/resync 时读取最新设置；请求序号/更新时间防止过期读取覆盖较新的本地提交。
- 多客户端提交采用最后成功保存生效；事件只更新正式设置，不覆盖已打开的本地编辑草稿。

## 4. Desktop / WebUI Controllers

桌面存在两个独立入口：NewChatLanding 管理未发送的普通/临时草稿，use-chat-session-config 管理已打开的会话。两者均读取项目偏好并订阅项目事件，将有效 Scope 和管理回调传入 ChatComposer；两者的 Scope 快捷键也必须使用同一有效列表。不能只接入 ChatPage。加载占位 composer 没有配置 controller，禁用管理入口。

桌面两种入口继续读取已有模型目录缓存；额外加载项目设置，分别保留原目录与有效 Scope。原始目录保存在 React state，hydrate、订阅与刷新同步更新全部模型和这份 snapshot；Scope 从同一 snapshot 派生，不能在 render 另读全局 cache 导致状态脱节。项目/会话切换后忽略旧请求与 hydrate 回调。

继承要求完整默认 Scope 元数据；自定义只要求成功加载可用目录，不依赖 Pi 默认 Scope 的解析。两种视图共享目录 loading/error，后台刷新旧缓存也标记 loading；有有效列表时保留展示，没有数据时显示读取状态，不提前报缺元数据。

WebUI 的活动会话 get_available_models 返回的原始模型没有 Scope 元数据，不能直接把它当作完整默认 Scope。将 Host 缓存的 Pi 默认目录元数据与 live available model 身份匹配，再应用项目偏好。草稿仍读取 Host 缓存；不新增浏览器发起的探测进程。

项目设置加载/保存的共享逻辑应通过 PiloClient 或注入 callbacks 复用，按 client/project 隔离状态。网络失败显示错误，不把“加载失败”当作“未设置”。不引入新的全局 store 库。

## 5. Picker / Draft Interaction

继续通过 ChatComposer -> ComposerRunConfig 的共享组件覆盖两端。

- 搜索、全部/Scope 切换、Scope 来源与编辑入口由共享模型选择组件负责。
- 桌面保留原有“模型 / 推理等级”两级 DropdownMenu 与紧凑列表样式，只在模型子面板接入共享搜索/Scope picker；推理等级保留原有子菜单，不套用触屏平铺面板。
- 模型子面板包含输入与 Command，采用 dialog 语义；内部键盘事件在冒泡至 Radix 菜单前截断，避免 typeahead/方向键抢占，并在面板内循环 Tab。键盘打开时聚焦搜索，Escape 关闭菜单；保存中保持面板，避免丢失失败后的草稿。
- picker 使用独立于偏好加载状态的 ModelScopeControls.projectId 作为 key，首次 scope 响应不重挂组件。刷新按钮先将焦点移到搜索，再启动刷新，避免按钮禁用触发焦点离开关闭子菜单；刷新不重置视图、搜索或草稿。
- 桌面主菜单 side=top、sideOffset=8；两种子面板 align=end、alignOffset=-24，较零偏移下移 24px，collisionPadding=16 保留窗口边距。控件复用 Button/Input/Checkbox 和语义颜色，模型列表保持紧凑。
- 触屏继续使用底部 Dialog sheet，复用共享模型选择列表。桌面应用与桌面布局的 WebUI 可编辑；移动窄屏仅提供搜索、全部/Scope 切换、模型选择、来源展示与同步，不显示管理操作。
- 通过明确的 canEditScope prop 表达入口/布局差异，桌面应用允许编辑，WebUI 按现有响应式布局决定；不用 touch/hover 探测替代移动布局判定，避免触屏桌面被误当作只读。隐藏入口是交互范围，不是新增授权模型。
- 搜索覆盖 name、id、provider。手动过滤与 Command 过滤只能选一个 owner，避免两次过滤和“行消失但勾选按钮留下”。
- 浏览模式的模型选择与编辑模式的成员勾选分离，避免点击勾选时切换当前模型。

桌面管理入口的草稿流程：

```text
打开编辑 -> 复制有效列表/自定义完整成员 -> 搜索与批量勾选
          -> 应用：一次保存全部 -> 成功后替换正式偏好
          -> 取消/关闭：丢弃草稿
```

自定义列表里暂时不可用的成员保留在草稿中，显示不可用状态并允许移除；不会参与正常选择、搜索候选批量添加或轮切。搜索与保存不能静默删除未显示的成员。

未修改继承草稿时不能无意创建覆盖；通过 dirty 判断禁用应用或视为无操作。恢复继承通过明确操作提交 null，清空提交 []。

保存失败保留草稿和原偏好；保存中禁用重复应用。正在运行的 Agent 不受成员编辑影响，应用不自动改模型。

## 6. Scoped Cycling / Thinking

- 普通“全部模型轮切”保持现有逻辑。
- Scope 快捷键使用同一有效成员列表，在 Pilo 内选出目标，再用现有 set_model 切换。
- 不继续让 Pi 原生 cycle_model 决定项目覆盖场景的目标，否则会形成两份有效 Scope。
- 继承列表中的明确 scopeThinkingLevel 在 Scope 轮切时使用；其他模型保留现有默认思考等级行为。
- 空或没有可用成员时无操作；单模型重复轮切不切换。
- 历史会话的延迟运行时配置与临时会话仍遵循原有控制流程；编辑偏好不 ensure/start/restart Pi。

## 7. Accessibility / Mobile

- 搜索输入有可访问名称；视图切换与勾选状态可被辅助技术读取。
- 独立的模型选择与勾选 hit area，避免嵌套按钮。
- 移动端模型选择与视图切换有足够大目标；支持编辑的桌面触屏场景中，勾选、取消、应用同样可触控。长名称可截断但不遮挡操作。
- 抽屉高度/底部定位考虑 visualViewport 与现有 --remote-viewport-height，不只依赖 dvh；安全区 padding 保留。
- 所有新增文案进入 en-US / zh-CN resources；不翻译供应商、模型身份和用户配置内容。

## 8. Compatibility / Rollback

- 已有项目默认无偏好行，即继承，升级不会突然得到自定义覆盖。
- 现有模型目录数据与 TTL 保留，不修改 scopeOrder 的意义，不让偏好保存伪造目录刷新时间。
- 旧客户端不知道新表/字段时仍按原行为运行；同版本桌面和内嵌 WebUI 同步更新。
- 回滚代码不删除新偏好表或用户数据；Pi 配置始终未被修改。
- 本任务不承诺默认 Pi settings.json 的实时监控，复用现有目录刷新。

## Validation Constraint

当前用户未授权运行测试或构建。实现前后的源码/diff 检查可进行；验证命令先记录在 implement.md，明确授权后再执行。Windows 桌面 GUI 验证必须在 Windows 侧执行。
