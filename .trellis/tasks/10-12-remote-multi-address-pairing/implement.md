# 实施计划：多地址一次扫码配对

## 开始条件

- [x] 用户在阅读本轮最终规划摘要后明确批准进入实现。
- [x] 已执行 task.py start；任务保持 in_progress，运行验证与提交待授权。
- [x] 重读 PRD、design、research/auth-flow.md 和相关前后端规范。
- [x] 再检查工作区，保留用户的 index.html、src/lib/theme-provider.tsx、src/remote/sw.js 等既有修改，不重排、不覆盖。

## 改动边界

必须覆盖：配置存储 → manager 生命周期 → desktop commands / DTO → HTTP 配对接口 → 浏览器临时上下文 → 手机认证 UI → 桌面设置 UI → 双语文案。

实际必要文件：

- src-tauri/src/domain/remote.rs、domain/mod.rs：新增访问地址 / 配置 DTO，保留既有配置和设备结构。
- src-tauri/src/runtime/storage/schema.rs、storage/remote.rs：guarded 访问配置列、兼容读写、原子设备签发。
- src-tauri/src/runtime/remote/access.rs、pairing.rs、manager.rs、auth.rs：批次地址快照、槽位 / 收据、TTL、失效与强随机凭证。
- src-tauri/src/runtime/remote/api/mod.rs、api/middleware.rs：受 secret 保护的配对描述路由、幂等兑换、no-store / 限流。
- src-tauri/src/runtime/commands/remote.rs、commands/mod.rs、src-tauri/src/lib.rs：注册新增配置命令，不堆业务逻辑。
- src/lib/remote.ts、src/components/settings/remote-settings.tsx：DTO / invoke 与多地址、入口选择、单二维码设置。
- src/remote/remote-app.tsx、use-remote-connection.ts、remote-client.ts：分离认证入口与聊天、统一兑换与上下文生命周期。
- 新增 src/remote/remote-pairing-page.tsx、remote-pairing-model.ts：认证 UI 与单一上下文 / 链接解析 owner，不引入通用路由框架。
- src/i18n/resources/en-US.ts、zh-CN.ts：新文案与旧「一次性 · 5 分钟」文案替换。
- .trellis/spec/backend/remote-webui.md：实施完成后同步实际凭证与 HTTP 契约，不提前把设计写成已实现事实。

不改聊天 Runtime / Pi RPC、主题、SW、端口更改策略、其他 active task 或无关测试；不新增依赖。

## 1. 配置与迁移

- [x] 按 design 新增稳定地址 ID、可选名称及二维码入口配置。
- [x] 严格解析 http(s) 根地址、拒绝 URL 凭证 / query / fragment、规范化并按 origin 去重。
- [x] NULL 新配置投影 LAN + 旧外部地址；显式保存后以新列表为准，不用每次读取覆盖用户数据。
- [x] 保留旧配置字段和 command 兼容路径，非法旧值保留修正提示。
- [x] 新增 command / invoke 镜像与注册；地址变更不清空 devices。

审阅：旧配置与原有 struct literal / helper 调用仍可用；初始默认 LAN、用户完整地址列表和二维码入口具有一致定义。

## 2. 批次与兑换契约

- [x] secret 改为 10 分钟，设备 token 保持 30 天，不自动续期。
- [x] 每次生成固定有效地址快照，按地址分配槽位；移除每兑换一个地址就轮转的行为。
- [x] 实现串行兑换与 SQLite 原子写入，提交后记录短期收据，不留 await 取消窗口。
- [x] 同一请求证明可安全领取原响应，不新增授权；不同证明不得读取其他 token。
- [x] 名额用满后不签发新授权，但 TTL 内本人收据重试仍可完成；过期、重新生成、stop / restart 清理旧批次。
- [x] 已吊销或失效设备不能从旧收据恢复；快照中设备信息不代替浏览器保存成功确认。
- [x] 新配对描述路由不消费名额、不返回 secret / token；同样验证 secret 并复用限流。
- [x] 配对响应 no-store，日志 / Debug 输出不含凭证；Bearer / WS 认证流程不变。

审阅：并发、DB 失败、response 丢失、最后一个槽位、过期临界点、吊销与重新生成竞态。

## 3. 认证选择页与目标页

- [x] WebUI 在 /pair 显示选择页，不挂载聊天连接子树、不自动消费当前 origin。
- [x] 统一解析 fragment / 遗留 query，保存短期 sessionStorage 上下文后尽早清 URL。
- [x] 目标按钮使用同标签页可信 URL，地址 / 入口 ID 对照服务端快照，不支持任意 returnUrl。
- [x] /pair/complete 在目标 origin 生成并保存强随机 requestId，再幂等兑换；不使用 Math.random fallback。
- [x] 成功保存 localStorage token 后提供进入聊天、回原认证页继续、普通书签入口；不会重新签发已保存授权。
- [x] 处理网络失败、无权限、超时、重复地址冲突、存储禁用和恢复前台；过期清临时上下文。
- [x] 区分授权签发状态和本页面实际认证完成状态，不将仅点击的地址显示成已认证。

## 4. 桌面配置与移动端 UI

- [x] 地址可增删改、名称可留空，有名称仍展示真实地址。
- [x] 一个二维码，可选入口默认 LAN；展示 10 分钟到期、剩余名额、重新生成。
- [x] 两语言资源同步，不硬编码单语言文案。
- [x] 窄屏地址换行、44px 触控目标、键盘可操作、safe-area / 动态视口；复用 src/ui。
- [x] 确认没有为配对改写用户 SW，API 与凭证不进入任何缓存。

## 5. 最终审阅与验证

- [x] 对整个任务 diff 与完整调用链做静态审阅，逐项核对 PRD AC1–AC12，而非仅查看最后一个改动。
- [x] 检查旧 DTO、旧 command、存储 helper 与既有测试源码调用没有被新必填字段破坏；未经请求不修改测试。
- [x] 依据实际实现更新 Remote WebUI spec，记录幂等 / 配额 / TTL / 页面生命周期契约。

用户已明确授权前后端构建和类型检查。已通过 pnpm check、pnpm build、cargo fmt --all --check、cargo check、cargo clippy --all-targets --all-features -- -D warnings。格式化仍只针对本任务文件，未运行全项目写入式 pnpm format；编译检查不代替运行验收。

```bash
pnpm format
pnpm check
pnpm build
cargo fmt --all --check
cargo check
cargo clippy --all-targets --all-features -- -D warnings
```

不默认运行单元测试、不创建或修改测试。若新契约需要回归测试，先获得明确授权。

获准进行 UI 验证后，覆盖：

1. Windows 桌面 pnpm tauri dev：旧配置迁移、列表编辑、入口切换、只一个二维码、剩余名额与设备独立吊销。
2. 手机 WebUI：一次扫码 → 选择页 → 三个目标各兑换 → 返回 → 普通书签可用。
3. 异常：不可达目标、10 分钟到期、重复点击 / StrictMode、响应丢失、最后名额、手动重新生成、进程重启、吊销和浏览器存储禁用。
4. 安全：无 token URL、无凭证日志 / HTTP cache、没有 requestId 证明不能领取别人 token；HTTP / HTTPS 顶层导航与手机目标浏览器实际行为。

Windows 桌面 / 手机 / 真实网络无法执行时，明确报告未验证；不能把静态审阅说成运行通过。

## 本轮结果与待验证项

- 已完成配置、后端配额 / 幂等接口、桌面单二维码设置和 WebUI 认证页，并同步实际设计与 spec。
- 仅针对本任务 9 个 TS/TSX 文件运行 oxfmt / oxlint（React 与 jsx-a11y，deny-warnings）；只针对本任务 Rust 文件运行 rustfmt（edition 2024，skip_children）。
- git diff --check 与完整调用链静态审阅；既有 cfg(test) 测试块保持原样。未添加依赖、测试或改写 SW。
- 静态审阅修正：SQLite 等锁后重新检查 TTL、收据取回检查 TTL、网络刷新时保留可信配对链接、复扫同批次保留当前 origin 的重试证明、过期刷新清理临时上下文并提示。
- 当前还有独立的聊天 UI 修改（chat-composer.tsx、chat-page.tsx 和 remote-app.tsx 的 statusError）；保持其内容，后续提交需明确分开范围。
- [x] 用户授权后通过 pnpm check（全项目格式 / lint）、pnpm build（tsc + Vite + PWA）、cargo fmt --all --check、cargo check、cargo clippy --all-targets --all-features -- -D warnings。clippy 编译检查包含既有测试 target，但未运行测试。
- [ ] 测试和并发 / DB 失败 / 响应丢失的运行验证：未经授权，未执行；不能据此声称 AC5 / AC12 已通过。
- [ ] Windows 桌面、手机和三个真实 origin 的端到端验收：未执行；PRD AC1–AC12 保持未勾选。
- [ ] 用户确认本任务提交范围与提交：尚未提交、推送或归档。

## 回退与提交

- 迁移为加法，不删除旧配置列或设备数据；需要回退时关闭 Remote 服务使临时批次失效，再回退本任务代码，不回滚用户无关修改。
- 配置、后端和 UI 必须一起提交，不能发布契约不匹配的中间状态。
- 提交前列出本任务文件与用户既有修改，按 git-commit / Trellis 流程取得确认；本任务本轮不提交、不推送、不升版本。
