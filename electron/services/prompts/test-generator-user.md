请根据以下代码分析结果和原始请求，生成接口测试用例。

## 原始请求
- 方法：{{METHOD}}
- 路径：{{PATH}}
- 完整URL：{{URL}}
- 请求体：{{REQUEST_BODY}}
- 请求头：{{REQUEST_HEADERS}}

## 代码分析结果
{{CODE_EXPLORATION_RESULT}}

## 要求
1. 按测试用例设计原则生成场景（数量由代码复杂度决定，最多 15 个）
2. curl 命令使用原始 URL 和 Headers，testData 替换为测试值
3. Python 断言严格遵循项目断言规范（逐字段 assert，带中文错误消息）
4. 场景按优先级排序（正常流程排第一个）
5. analysisSummary 用 Markdown 汇总所有场景的覆盖情况
6. 为每个场景的 expectedStatusCode 设置正确的 HTTP 状态码
7. 为每个场景的 testData 设置该场景使用的测试数据

请自主决策，不需要询问用户许可。
