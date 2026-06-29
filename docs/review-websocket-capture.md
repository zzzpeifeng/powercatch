# #15 WebSocket 抓包 - 评审报告

> **评审日期**: 2026-06-29  
> **评审人**: 齐活林（Qi）· 交付总监  
> **Plan 版本**: v1.2  
> **评审结论**: ✅ **通过**（已修复所有问题）  

---

## 1. 评审意见

### 1.1 优点 ✅

1. **数据模型设计合理**
   - WebSocketMessage 和 WebSocketConnection 接口定义清晰
   - 支持消息方向（客户端→服务器 / 服务器→客户端）
   - 支持消息类型（文本/二进制/控制帧）

2. **架构设计完整**
   - 从代理层到 UI 层的流程清晰
   - 使用 http-mitm-proxy 的 WebSocket 事件（已验证）
   - 主进程推送消息到渲染进程（实时更新 UI）

3. **消息存储策略合理**
   - 限制内存 1000 条，避免性能问题
   - 可选持久化到数据库（会话保存/恢复）

4. **Hex 查看器设计合理**
   - 类似 Wireshark，用户体验好
   - 支持虚拟滚动，性能优化
   - 详见 `docs/hex-viewer-implementation.md`

5. **IPC 设计简化**
   - 无需复杂的 IPC 调用
   - 主进程推送事件（`websocket:message-added` / `websocket:connection-closed`）
   - 渲染进程通过 Store 管理消息状态

---

### 1.2 需要修改的问题 ⚠️（已修复）

**问题 1：消息类型检测逻辑错误** ❌ → ✅ 已修复
- **原问题**：`websocket-handler.ts` 中的 `detectMessageType()` 尝试从原始数据读取 WebSocket 操作码
- **错误原因**：`onWebSocketSend`/`onWebSocketMessage` 事件返回的是**消息内容**（已解码的 payload），不是完整的 WebSocket 帧
- **修复方案**：根据内容特征判断类型（尝试 UTF-8 解码 → 文本；否则 → 二进制）
- **修复位置**：`docs/plan-websocket-capture.md` 第 264-280 行

**问题 2：T2 任务与设计方案矛盾** ❌ → ✅ 已修复
- **原问题**：设计方案说"简化 IPC，无需数据库"，但 T2 任务仍包含数据库和 IPC 文件
- **修复方案**：删除 T2 任务，重新编号为 T1/T2/T3/T4/T5
- **修复位置**：`docs/plan-websocket-capture.md` 第 667-741 行

**问题 3：控制帧处理不明确** ⚠️ → ✅ 已修复
- **原问题**：Plan 说要捕获 Ping/Pong/Close，但 `onWebSocketSend`/`onWebSocketMessage` 可能不包含控制帧
- **修复方案**：添加控制帧处理说明（需要验证 http-mitm-proxy 是否提供控制帧事件）
- **修复位置**：`docs/plan-websocket-capture.md` 第 417-420 行

**问题 4：消息过滤实现不明确** ⚠️ → ✅ 已修复
- **原问题**：Plan 说"实现基本过滤（按方向 + 类型）"，但没有说明具体实现方式
- **修复方案**：添加过滤状态（`filterDirection` / `filterType` / `searchQuery`）和 `filteredMessages` 计算属性
- **修复位置**：`docs/plan-websocket-capture.md` 第 439-478 行

**问题 5：待确认问题未更新** ⚠️ → ✅ 已修复
- **原问题**：第 9 节"待确认问题"应该已解决，但仍在文档中
- **修复方案**：更新为"已解决问题"
- **修复位置**：`docs/plan-websocket-capture.md` 第 795-807 行

---

## 2. 评审结论

### ✅ 通过（已修复所有问题）

**Plan v1.2 已准备就绪**，可以开始实现。

**关键修复**：
1. ✅ 消息类型检测逻辑已修复（基于内容特征判断）
2. ✅ T2 任务已删除（与设计方案矛盾）
3. ✅ 控制帧处理说明已添加
4. ✅ 消息过滤实现已明确（计算属性）
5. ✅ 待确认问题已更新为"已解决问题"

---

## 3. 下一步建议

### 3.1 立即开始实现

**建议的工作流**：
1. **创建团队**（TeamCreate）
2. **分派给工程师**（寇豆码）
   - 提供 Plan 文档（`docs/plan-websocket-capture.md`）
   - 提供 Hex 查看器实现方案（`docs/hex-viewer-implementation.md`）
   - 建议技术栈：Electron + Vue 3 + Pinia + TypeScript
3. **工程师实现代码**（按 T1 → T2 → T3 → T4 顺序）
4. **QA 工程师验证**（按测试计划执行）

### 3.2 需要验证的问题

**在实现前需要验证**：
1. **http-mitm-proxy 的控制帧事件**
   - 是否提供 `onWebSocketPing` / `onWebSocketPong` 事件？
   - 如不支持，v1.0 暂不显示控制帧

2. **消息推送性能**
   - 高频消息（>1000 条/秒）时，IPC 事件是否会导致 UI 阻塞？
   - 如会，需要添加节流（throttle）机制

### 3.3 可选功能（后续版本）

**T5 任务（会话保存/恢复支持）**可以后续版本再实现：
- 保存会话时，将内存中的 WebSocket 消息写入数据库
- 恢复会话时，从数据库加载消息到内存
- 不保存会话时，关闭应用后消息丢失（符合预期）

---

## 4. 附录：文档清单

| 文档名 | 路径 | 说明 |
|--------|------|------|
| WebSocket 抓包技术方案 | `docs/plan-websocket-capture.md` | Plan v1.2（已评审通过） |
| Hex 查看器实现方案 | `docs/hex-viewer-implementation.md` | 虚拟滚动 + 性能优化 |
| 评审报告 | `docs/review-websocket-capture.md` | 本文档 |

---

**评审人签字**：齐活林（Qi）· 交付总监  
**日期**：2026-06-29
