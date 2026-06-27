# PowerCatch 功能实现进度跟踪

> 每完成一个功能，把 `[ ]` 改成 `[x]` 即可。  
> 更新日期：2026-06-27 | 总计：32 项 | 已完成：15 | 进行中：0

---

## 🏗️ 基础设施（地基，必须先做）

- [x] **#1 高级过滤系统** | 工作量:小 | 依赖:无 | ✅ 2026-06-19
  - HTTP方法 / 状态码 / Content-Type / 响应时间 / 请求体大小 / 设备IP 多维度组合过滤
  - 改动文件：`types.ts` + `filter-engine.ts`(新增) + `request-store.ts` + `RequestList.vue` + `FilterPanel.vue`(新增) + `ActiveFilterTags.vue`(新增)

- [x] **#2 响应体智能预览** | 工作量:中小 | 依赖:无 | ✅ 2026-06-20
  - JSON树形折叠 / 图片渲染 / Hex查看 / HTML预览 / 语法高亮
  - 改动文件：`body-preview-parser.ts`(新增) + `BodyPreviewRouter.vue`(新增) + `JsonViewer.vue`(新增) + `HtmlViewer.vue`(新增) + `ImageViewer.vue`(新增) + `HexViewer.vue`(新增) + `CodeViewer.vue`(新增) + `RequestDetail.vue` + `mitm-server.ts`

- [x] **#3 会话保存与恢复** | 工作量:小 | 依赖:无 | ✅ 2026-06-27
  - 保存/加载抓包会话到SQLite，含过滤状态和视图模式
  - `sqlite.ts` + `SessionManager.vue`(新增) + `request-store.ts` + `RecordControl.vue` + `MainView.vue`

- [ ] **#4 大响应体处理** | 工作量:小 | 依赖:无
  - >5MB自动截断 + 标记提示 + 按需加载完整内容
  - `mitm-server.ts` + `RequestDetail.vue`

- [x] **#5 主题切换（明/暗模式）** | 工作量:小 | 依赖:无 | ✅ 已实现
  - 明暗主题开关，持久化到settings-store
  - `settings-store.ts` + `SettingsView.vue`（theme state + applyTheme + setTheme + 系统主题监听）

---

## 🔥 高价值（对标 Charles 核心能力）

- [x] **#6 断点 & 请求/响应修改** | 工作量:中 | 依赖:无 | ✅ 2026-06-21
  - URL断点拦截，手动修改headers/body/status后放行，右键上下文菜单快速添加断点
  - 改动文件：`breakpoint-matcher.ts`(新增) + `curl-generator.ts`(新增) + `breakpoint-store.ts`(新增) + `BreakpointDialog.vue`(新增) + `BreakpointRules.vue`(新增) + `RequestContextMenu.vue`(新增) + `types.ts` + `request-store.ts` + `mitm-server.ts` + `preload.ts` + `ipc.ts` + `sqlite.ts`

- [x] **#7 Map Local（本地映射）** | 工作量:小 | 依赖:无 | ✅ 2026-06-22
  - 接口响应替换为本地文件（JSON/JS/CSS）
  - `mitm-server.ts` + 映射规则管理UI

- [x] **#8 请求重放 & 编辑重发** | 工作量:小 | 依赖:#3 | ✅ 2026-06-27
  - 右键→复制cURL / 直接重发 / 修改参数后重发
  - `RequestContextMenu.vue` + `ReplayDialog.vue`(新增) + `RequestList.vue`

- [x] **#9 Map Remote（远程映射）** | 工作量:小 | 依赖:无 | ✅ 2026-06-26
  - A域名请求转发到B域名（线上→测试环境）
  - `mitm-server.ts` + `map-remote-matcher.ts`(新增) + `map-remote-store.ts`(新增) + `MapRemoteRules.vue`(新增)

- [x] **#10 自动响应器（Auto Responder）** | 工作量:小 | 依赖:#7 | ✅ 2026-06-27
  - 不请求真实服务器，直接本地规则响应，支持延迟/状态码模拟
  - `mitm-server.ts` + `AutoResponderRules.vue`(新增) + `auto-responder-store.ts`(新增) + `auto-responder-matcher.ts`(新增)

- [x] **#11 请求重写规则（Rewrite Rules）** | 工作量:中 | 依赖:无 | ✅ 2026-06-27
  - 持久化自动修改匹配请求的URL/Header/Body/Status
  - `mitm-server.ts` + `RewriteRules.vue`(新增) + `rewrite-rules-store.ts`(新增) + `rewrite-matcher.ts`(新增)

---

## 💡 中价值（提升效率）

- [x] **#12 请求 Diff 视图** | 工作量:中 | 依赖:无 | ✅ 2026-06-26
  - 两个请求的纯文本/JSON结构化diff，三色标记，导出HTML/MD/JSON
  - `diff-engine.ts`(新增) + `diff-store.ts`(新增) + `diff-export.ts`(新增) + `DiffView.vue`(新增) + `DiffOverview.vue`(新增) + `DiffHeaders.vue`(新增) + `DiffBody.vue`(新增) + `router/index.ts` + `App.vue` + `RecordControl.vue` + `MainView.vue`

- [ ] **#13 带宽限流 / 网络节流** | 工作量:中 | 依赖:无
  - 模拟3G/4G/弱网，设置延迟和丢包率
  - `mitm-server.ts` + 设置页UI

- [ ] **#14 请求时间线（Waterfall）** | 工作量:中 | 依赖:mitm-server打点
  - 瀑布图展示DNS/TTFB/下载时间分布
  - `WaterfallView.vue` + `mitm-server.ts`

- [ ] **#15 WebSocket 抓包** | 工作量:中 | 依赖:无
  - 捕获WS/WSS消息（帧级别）
  - `mitm-server.ts` + WS消息列表UI

- [x] **#16 DNS 覆盖** | 工作量:小 | 依赖:无 | ✅ 2026-06-27
  - 代理层域名指向自定义IP，不改hosts文件
  - `mitm-server.ts` + `DnsOverrideRules.vue`(新增) + `dns-override-store.ts`(新增) + `dns-override-matcher.ts`(新增)

- [ ] **#17 Cookie 管理器** | 工作量:中小 | 依赖:无
  - 按域名查看/编辑/删除Cookie，导入导出Cookie Jar
  - `CookieManager.vue` + `mitm-server.ts`

- [ ] **#18 上游代理链（Upstream Proxy）** | 工作量:中小 | 依赖:无
  - 转发到上级代理，串联Charles双层抓包
  - `mitm-server.ts` + `SettingsView.vue`

---

## 🌟 锦上添花（差异化特色）

- [ ] **#19 单请求 AI 分析** | 工作量:小 | 依赖:无
  - 单个请求一键调AI分析错误原因
  - `RequestDetail.vue` + AI分析按钮

- [ ] **#20 请求统计面板** | 工作量:中 | 依赖:#1
  - 域名/状态码/响应时间聚合图表
  - `StatsView.vue` + 统计聚合逻辑

- [x] **#21 多格式导出** | 工作量:小 | 依赖:#3 | ✅ 2026-06-27
  - cURL / Postman Collection / JMeter 脚本 / fetch / Python requests
  - `export-service.ts`(新增) + `RequestContextMenu.vue`

- [x] **#22 HAR 导入/导出** | 工作量:小 | 依赖:#3 | ✅ 2026-06-27
  - 兼容Chrome DevTools HAR格式
  - `har-export.ts`(新增) + `har-import.ts`(新增) + `RecordControl.vue` + `MainView.vue`

- [ ] **#23 GraphQL 感知** | 工作量:小 | 依赖:无
  - 识别GraphQL请求，按operation name分组
  - `request-matcher.ts` + `tree-builder.ts`

- [ ] **#24 请求书签 / 收藏** | 工作量:小 | 依赖:#1
  - 标记常用接口快速定位（高级过滤做好后需求降低）
  - `request-store.ts` + `RequestList.vue`

- [ ] **#25 性能监控仪表盘** | 工作量:中 | 依赖:无
  - 内存/CPU/请求速率/数据库大小监控
  - `main.ts` + 监控UI

- [ ] **#26 多标签页** | 工作量:大 | 依赖:Store架构改造
  - 多抓包会话Tab对比（建议延后）
  - Store架构改造 + Tab UI

---

## 🛠️ 非功能性需求（持续迭代）

- [ ] 搜索性能优化（万级请求索引）
- [ ] 内存管理（长时间录制不泄漏）
- [ ] 启动速度优化（冷启动 <3s）
- [ ] 自动更新（Electron updater）
- [ ] SQLite 性能（WAL模式 + 索引优化）
- [ ] 证书管理 UI（一键安装/信任/导出CA）

---

## 📈 进度统计

| 层级 | 总数 | 已完成 | 进度 |
|------|------|--------|------|
| 🏗️ 基础设施 | 5 | 4 | ████░ 80% |
| 🔥 高价值 | 6 | 6 | ██████ 100% |
| 💡 中价值 | 7 | 2 | ██░░░░░ 29% |
| 🌟 锦上添花 | 8 | 2 | ██░░░░░░ 25% |
| 🛠️ 非功能 | 6 | 0 | ░░░░░░ 0% |
| **合计** | **32** | **15** | **47%** |
