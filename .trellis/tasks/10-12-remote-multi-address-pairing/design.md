# 技术设计：多地址认证选择页

## 状态与最小改动边界

最终规划已获用户批准，任务已进入 in_progress。本文件同步实际实现边界；用户授权后已通过前后端构建和类型 / lint 检查，测试与真实设备运行验收仍未执行。

当前缺口是单地址、一次性兑换并直接进入聊天；目标是同一短期配对会话覆盖多个地址，先选地址，再在目标 origin 兑换。继续使用现有 Rust RemoteServerManager、SQLite 设备授权、Axum 路由和 WebUI，不新增 crate、依赖、认证服务或跨 origin 通信桥。

分为三个同一任务内的实施步骤：配置与迁移、配额与接口、两端 UI。它们共同组成一个验收结果，无需拆成独立子任务。

## 1. 地址配置

新增访问地址 DTO：稳定 id、可选 name、baseUrl；配置另含二维码入口 addressId。

- 保留既有 RemoteHostConfig 和 RemoteDevice 字段及旧存储 helper 的兼容入口，避免破坏现有 struct literal 调用者和未经允许修改测试。
- 为多地址引入单独的访问配置类型，在 remote_host_config 中 guarded 增加 addresses_json 和入口 ID；NULL 表示尚未保存新配置，不把 [] 与旧库未迁移混淆。
- 未保存新配置时，从运行时 LAN 地址和合法旧 public_base_url 投影出初始列表，按 origin 去重，默认二维码入口为 LAN。不在每次读取时覆盖已保存的用户列表。
- 用户首次保存后，显式列表成为权威配置；可增删改完整地址，保留稳定 ID，不偷偷追加隐藏 LAN 项或增加名额。
- 原外部地址存在但不合法时保留修正提示，不将它变成可携带 secret 的目标；有效 LAN 入口仍可用，不清空设备授权。
- 保留旧 publicBaseUrl 字段 / remote_set_public_base_url command 的兼容入口，由 manager 更新相应旧地址条目，不允许旧调用无意覆盖整个新列表。新 UI 使用新增访问配置 command。

用现有 tauri::Url 解析 URL，只允许 http(s)、有 host、无 userinfo / query / fragment 的根地址。按协议、host、有效端口统一规范化与去重；当前 WebUI 使用 /api/v1/**、SW scope /，不宣称支持反向代理子路径挂载。错误明确提示，而不是无声删除旧值。

地址集合或实际 URL 变更后，作废旧批次并生成新批次；名称和二维码入口切换不新增名额，不延长 TTL。所有配置调整均不清空设备表，不复用 set_port 的清设备路径。

## 2. 配对会话与原子签发

ActivePairing 扩展为短期批次：secret、secret hash、10 分钟绝对到期时间、地址快照、每地址槽位及短期兑换收据。manager 是唯一会话所有者；HTTP handler 不自行轮转。

每地址槽位状态：未兑换 / 已签发（关联 requestId hash、device ID、原 token）。地址 ID 是配额索引，不是 origin 权限限制。

数据库仍只持久化凭证 hash 和设备记录；remote_pairing 的 consumed_at_ms 表示批次不再接受新签发，不再表示第一个地址已兑换。地址槽位与原 token 收据仅留在进程内，最多列表长度项，原始 TTL 到期即清除。重启、关闭服务或手动重新生成使旧批次立即失效。

### 新兑换

1. 验证 secret、TTL、批次状态、地址 ID、requestId 与字段长度。
2. 同一批次使用同一串行锁判定槽位，避免并发请求分别判断为未兑换。
3. 复用服务端 CSPRNG 生成 device ID / token，准备设备记录；设备名称可附地址名称或 host，继续经过现有长度限制，让三条记录易于识别。
4. 存储层在一个 SQLite 事务中检查活跃批次 hash / TTL，插入设备，必要时更新批次耗尽标记；失败完整回滚。
5. 提交成功后，在同一个不可被 HTTP future 取消中途打断的同步操作中更新槽位 / 收据，再返回响应。不允许 SQL 提交后、收据记录前出现 await。

实现由 remote/access.rs 负责配置规范化，remote/pairing.rs 的 PairingSession 负责共享批次。配置保存、启动和重新生成持有 manager 的外层 Tokio mutex 并等待 spawn_blocking，以串行化配置与批次变更；HTTP 不取得该外层锁，数据库 / 批次同步锁仅在 blocking worker 内等待。snapshot 克隆运行引用后释放外层锁再读取。管理操作在调用 snapshot 前显式释放外层锁，禁止反向锁序或重入。

设备签发在取得 SQLite immediate transaction 锁后按当前时间再次检查 TTL，不能拿等锁前的设备创建时间代替。收据重试检查设备未吊销 / 未过期后也再次检查批次 TTL。每次请求与桌面快照及时清理过期批次；listener 自身每 15 秒额外清理闲置收据，服务与清理 future 并行轮询，避免清理等批次锁时暂停接受连接；清理循环随 listener 结束。stop 在等待服务结束前使批次失效；数据库 hash 检查阻止旧批次向新配置继续签发。

### 重复与响应丢失

- 浏览器在目标 origin 首次兑换前，用 crypto.getRandomValues 生成 32 字节随机 requestId，保存到 sessionStorage，再发送请求。
- 相同 secret + addressId + requestId 的重试返回同一设备和原 token，不新增记录、不扣额外名额、不延长 30 天有效期。
- 相同槽位但不同 requestId 返回已使用冲突；绝不仅凭共享 secret 与 addressId 返回已签发 token。
- 收据返回前检查设备仍有效、未被吊销。重新生成、到期、重启后收据不能恢复授权。
- 用满后禁止任何新签发，但原请求在原 10 分钟 TTL 内可凭其高熵重试证明领取已签发响应。这是响应幂等，不是延长 secret 或发新授权。
- 不直接复用 utils.randomId 作为证明，因为它有 Math.random 回退；强随机源不可用时明确失败，不静默降级。

## 3. HTTP 与桌面接口

所有字段沿用 camelCase；类型与解码由 DTO / client 边界统一管理。

### 桌面

RemoteHostState 增加有效地址列表、入口 addressId 和配额摘要；保留 enabled / running / port / baseUrl / pairingUrl / pairingExpiresAtMs / devices 等兼容字段。

新增保存地址列表与入口选择的 command，经过 commands/remote.rs、commands/mod.rs 和 lib.rs 注册；业务校验、迁移投影和批次管理仍由 manager / storage 负责。

### WebUI

新增 POST /api/v1/auth/pairing，body 为 { secret }，用于读取配对会话地址快照、expiry、剩余槽位及状态；不兑换、不返回 secret 或任何 device token。公开路由不等于无授权：必须验证调用者已持有有效短期 secret，不能让未配对访客查询活跃配对凭证。名额用满但尚未超过原 TTL 时，可返回已耗尽状态与普通无凭证地址，不能提供新的兑换权限；到期、重新生成或重启后拒绝旧批次。

扩展 POST /api/v1/auth/pair：{ secret, addressId, requestId, deviceName? }，保留成功响应 { token, device }。必要字段不完整时明确失败，不隐式消费随机地址。

- 401：secret 失效或无授权。
- 400：格式、地址 ID 或输入不合法。
- 409：该地址已由其他请求兑换。
- 429：沿用现有配对失败 IP 限流。
- 500：内部失败，无丢失配额。

两个短期凭证接口复用配对限流；设备 Bearer / WS auth 仍不加 IP 限流。配对响应使用 Cache-Control: no-store，不记录 secret、requestId、token 或完整请求 body。

日常聊天、bootstrap、事件总线、WS subprotocol 不变，不新增 CORS 放开或后台跨 origin fetch。

## 4. 页面与导航

使用现有 SPA fallback，实际路径如下：

- 二维码：<entry>/pair#pair=<secret>，打开选择页。
- 目标按钮：<target>/pair/complete#pair=<secret>&address=<id>&entry=<entryId>，打开目标兑换页。
- 普通书签：<target>/，不含凭证。

RemoteApp 拆出轻量认证入口与原聊天工作区子树。选择页不挂载聊天连接 hooks，避免已有 token 或当前自动兑换 effect 把选择页直接送入聊天。只在目标兑换页执行兑换，成功存储 token 后展示「进入 Pilo」「继续认证其他地址」及普通地址书签提示。

### 临时上下文

- 一个受控入口解析 fragment，兼容读取遗留 ?pair= 后尽早清 URL；仅生成 fragment 链接。既有授权长期存储方式不变。
- 临时 secret、expiry、入口 ID 和待兑换 requestId 放在 sessionStorage，支持同标签页刷新与跨 origin 导航返回；不把临时 secret 写进长期 localStorage。
- 先安全保存临时上下文再清 URL；若存储被策略禁止，显示可操作错误，不发起可能丢失重试证明的兑换。
- 跳转使用普通同标签页链接，目标与返回 URL 均来自服务端已校验的配置快照；不信任 fragment 中的任意 returnUrl，不制造开放重定向。
- 回原选择页使用干净 /pair URL；原 origin 的同标签页 sessionStorage 恢复上下文并重新校验服务端批次。
- 页面加载、刷新、返回、重新到前台及继续操作时检查 TTL；到期、重启 / 重新生成导致 401 时清理上下文、禁用兑换并提示新扫码授权。浏览器会话恢复不能绕过绝对 TTL。
- 只有 URL 被打开或后端签发记录存在，不能断言其他 origin 的浏览器已保存 token；区分「该地址已签发授权」和当前页面确认的「认证完成」，不读取跨 origin localStorage。

认证流程使用同一标签页操作；不承诺关闭标签页后继续。如果目标地址不可达，用户返回认证页再试；后台没有探测所有 HTTP 地址的 fetch / iframe。

## 5. UI 复用与移动端

桌面 RemoteSettings 用现有 SettingsRow、Input、Button、Select 和 QRCodeSVG 展示地址列表、可选名称、单二维码入口选择、10 分钟到期及剩余名额。沿用刷新机制，不另建设置状态框架。

WebUI 新增 feature-local 认证页组件及必要的上下文解析 helper，复用 src/ui，不复制聊天 UI。手机按钮至少 44px 可触控高度，地址长文本允许换行，表单与按钮窄屏堆叠，页面考虑 safe-area 和动态视口。所有文案同步 en-US / zh-CN。

现有 SW 已对 /api/v1/** 网络直通并只缓存 canonical App Shell；无需为此修改 SW，也不得将配对 response / 完整链接 / token 加入 precache。

## 6. 兼容与风险

- 旧设备 token、吊销行为和 AuthSession 无变化。合法旧地址配置保留；访问列表扩展通过新增类型完成，不要求修改现有测试构造。
- 老版本配对 secret 会在升级重启后失效，属已确认行为；缺少新兑换字段的旧前端明确提示更新，不放松配额检查。已有 token 的旧前端仍能使用原受保护接口。
- 某入口不可达就无法加载认证页，需要桌面切换可达入口。HTTP 的链路风险仍在，fragment 不消除 XSS 或浏览器历史 / 扩展读取风险。
- 相同 secret 泄露可能被用于抢占未使用地址槽位；独立 device token 只提供单独吊销，不实现地址级权限隔离。
- 不改变 set_port 现有策略；改端口的影响不属于重启或地址迁移的保留承诺。

## 7. 发布与回退

先完成迁移和后端契约，再连接 UI；不发布前后端不匹配的中间状态。新增列为加法迁移，保留旧配置列和设备表。回退前关闭 Remote 服务使临时批次失效；不要删除数据库或设备记录，旧二进制仍能读取原配置列。多地址新字段由旧版本忽略，不保证旧版本展示多地址。

## 8. 设计审阅点

- 契约：选择页不消费，目标页各消费一次，重复请求只返回本人原响应。
- 原子性：设备插入、耗尽标记和内存收据在同一串行操作内完成，不留取消窗口。
- 安全：hash-only 持久化、短期收据不公开、强随机证明、无任意重定向、无 token URL。
- 兼容：旧 DTO / 调用者 / 设备授权、合法旧地址迁移、配置变更不会清设备。
- 两端：桌面单二维码配置，手机选择 / 成功 / 失败 / 返回均完整。
