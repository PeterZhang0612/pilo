# 现有配对流程与设计依据

## 本轮调查范围

仅阅读源码、规范和浏览器文档，未运行测试、构建或桌面验证。fastcontext 工具发现未返回可用工具，源码定位使用 rg。

## 源码事实

- `src-tauri/src/runtime/remote/manager.rs`：管理 listener、ActivePairing 和二维码链接。启动生成新 secret，配对成功后当前 HTTP handler 再生成一次；配置地址目前仅覆盖链接基址。
- `src-tauri/src/runtime/remote/auth.rs`：服务端生成 32 字节随机 secret / token。设备有效期自签发起 30 天，数据库只保存凭证 SHA-256 hash。
- `src-tauri/src/runtime/storage/remote.rs`：consume_remote_pairing 自己提交事务，insert_remote_device 随后单独执行。多地址扩展不能简单重复使用现有「先消费、再插入」流程，否则设备插入失败会丢失配额。
- `src-tauri/src/runtime/storage/schema.rs:120`：remote_host_config / remote_pairing / remote_devices 在同一数据库内，迁移使用 guarded ALTER TABLE。
- `src-tauri/src/runtime/remote/api/mod.rs:139`：公开配对接口与受保护的聊天接口分开注册，无 CORS 放开逻辑；SPA fallback 支持不含扩展名的客户端路由。
- `src/remote/remote-client.ts:36`：配对请求是目标页面向自身 origin 的 POST /api/v1/auth/pair；日常请求使用 Bearer，WebSocket 使用 subprotocol。
- `src/remote/use-remote-connection.ts:109`：当前自动兑换 query secret；成功后保存 localStorage token、清除 URL。认证选择页不能继续无条件触发这个 effect。
- `src/main.tsx:176`、`:180`：WebUI 由 RemoteApp 启动，运行在 React.StrictMode 下。选择页应与聊天子树分离，兑换须具备服务端幂等保证。
- `src/lib/utils.ts:11`：randomId 最终可回退 Math.random，只适合普通 UI ID，不能直接拿来生成领取已签发 token 所需的重试证明。
- `src/remote/sw.js`：/api/v1/** 网络直通，导航只回退 canonical index.html；现有用户修改不属于本任务，不应覆盖。
- `src-tauri/src/runtime/storage/remote.rs` 的测试直接构造 RemoteHostConfig / RemoteDevice。保留这些既有结构及旧 helper 签名，用新增访问配置类型扩展，避免未经允许修改测试或破坏其编译。
- 现有 RemotePort 修改会清空设备；本任务不顺带重做端口变更策略。重启与地址配置迁移不得复用该清空路径。
- 本机已安装 Tauri 导出 tauri::Url（registry 中 tauri src/lib.rs:83），可用于严格 URL 解析，不需要新增 URL 依赖。

## 浏览器资料

通过 exa 读取 MDN：

- https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content
  - HTTPS 到 HTTP 的顶层导航不属于 mixed content；不使用跨 origin fetch / iframe 来静默写入认证。
- https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
  - 按 origin 和标签页隔离，可在同标签页导航返回与刷新后继续使用；关闭标签页结束 page session，浏览器可能进行会话恢复，因此仍必须检查服务端 TTL。
- https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues
  - 可以在非安全上下文使用；适用于 HTTP 局域网下生成高熵重试证明。缺失时明确报错，不退回 Math.random。
- https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment
  - fragment 不随页面请求发给服务端，但脚本仍可读取；应早清 URL，并避免日志、缓存或用户书签保留它。

## 相关规范

- `.trellis/spec/backend/remote-webui.md`：传输适配器边界、hash-only 持久化、设备吊销、配对限流、PWA 缓存边界。
- `.trellis/spec/backend/database-guidelines.md`：guarded columns、参数化 SQL、存储层所有权。
- `.trellis/spec/frontend/component-guidelines.md`、`hook-guidelines.md`、`type-safety.md`、`quality-guidelines.md`：共享 UI、明确 hooks 边界、unknown 输入校验及双语文案。
- `.trellis/spec/guides/cross-layer-thinking-guide.md`、`code-reuse-thinking-guide.md`：统一跨层 DTO 和凭证解析入口。

## 实施风险

配对 HTTP contract、桌面 DTO、数据库迁移、React 生命周期必须同时更新。不能只延长 TTL 和取消自动轮转；否则重复兑换、配额与设备签发原子性、响应丢失后的恢复、旧配置兼容均未解决。
