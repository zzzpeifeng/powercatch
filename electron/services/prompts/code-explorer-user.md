请分析以下 API 请求的完整代码链路：

## 请求信息
- 请求方法：{{METHOD}}
- 请求路径：{{PATH}}
- 完整 URL：{{URL}}
- 请求体：{{REQUEST_BODY}}
- 请求头：{{REQUEST_HEADERS}}

## 分析要求
1. 使用工具探索项目结构，找到路由注册和 Handler 入口
2. 从 Handler 开始向下完整追踪调用链（至少到 DB 操作或外部调用）
3. 分析每一步的参数、条件分支、错误返回
4. **关键**：不仅要看 struct tag，还要追踪 `param.Check()` / `param.Validate()` 等手动校验方法
5. **关键**：追踪 header 参数提取逻辑（如 `NewAppCtx`），提取 ticket/uid/otp 等 header 字段
6. **关键**：识别 feature-flag 分支（如 `config.UseXxx()`），标记为 `type: "feature-flag"`
7. **关键**：追踪 gRPC/Dubbo 客户端层的错误映射函数（如 `convBizError`）
8. 输出格式严格遵循上述 JSON Schema

## 工具使用提示
- 先用 get_file_tree 了解项目结构
- 用 search_code 搜索路由模式（如 "POST.*checkout"、路径片段）
- 用 read_file 读取 Handler → Service → Repository 的完整代码
- 确保每个 callee 都被展开读取

请自主决策，不需要询问用户许可。
