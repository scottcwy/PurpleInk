# Mimo适配器

<cite>
**本文引用的文件**   
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)
- [mimo-audio-client.ts](file://src/features/audio/mimo-audio-client.ts)
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)
- [model-routing.ts](file://src/features/ai/model-routing.ts)
- [openai-compatible-payloads.ts](file://src/features/ai/openai-compatible-payloads.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)
- [route-contract-error.ts](file://src/features/ai/route-contract-error.ts)
- [credentials.md](file://docs/configuration/credentials.md)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件面向Mimo AI适配器的集成与使用，覆盖认证流程、消息格式、流式响应处理、配置管理（凭据、模型参数、超时）、多模态输入、工具调用与函数执行、错误处理与重试机制，以及实际集成步骤、测试方法与性能优化建议。文档基于仓库中Mimo相关实现进行梳理，确保读者能够快速理解并正确接入Mimo能力。

## 项目结构
Mimo相关代码主要分布在以下模块：
- AI适配器层：提供统一的LLM调用接口与协议适配
- 音频客户端：封装Mimo音频能力（如TTS）的HTTP调用
- 路由与注册：统一注册Provider、按模型选择具体实现
- OpenAI兼容层：复用通用载荷构造与配置映射
- 导演编排：将适配器嵌入工作流，支持流式桥接与工具调用

```mermaid
graph TB
subgraph "AI适配层"
A["mimo-adapter.ts"]
B["mimo-config.ts"]
C["provider-registry.ts"]
D["model-routing.ts"]
E["openai-compatible-payloads.ts"]
F["openai-compatible-config.ts"]
G["route-contract-error.ts"]
end
subgraph "音频能力"
H["mimo-audio-client.ts"]
end
subgraph "导演编排"
I["pi-stream-bridge.ts"]
J["pi-tool-adapter.ts"]
end
A --> E
A --> F
A --> C
A --> D
A --> G
H --> A
I --> A
J --> A
```

图表来源
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)
- [mimo-audio-client.ts](file://src/features/audio/mimo-audio-client.ts)
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)
- [model-routing.ts](file://src/features/ai/model-routing.ts)
- [openai-compatible-payloads.ts](file://src/features/ai/openai-compatible-payloads.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)

章节来源
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)
- [mimo-audio-client.ts](file://src/features/audio/mimo-audio-client.ts)
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)
- [model-routing.ts](file://src/features/ai/model-routing.ts)
- [openai-compatible-payloads.ts](file://src/features/ai/openai-compatible-payloads.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)

## 核心组件
- Mimo适配器：封装对Mimo API的调用，包括请求构建、鉴权、流式读取、错误转换等
- Mimo配置：集中管理API密钥、基础URL、超时、重试策略、模型参数等
- Provider注册与路由：统一注册Mimo为可用Provider，并按模型名或标签选择具体实现
- OpenAI兼容层：复用通用的消息载荷构造、系统提示、工具定义等
- 音频客户端：封装Mimo音频服务（如TTS）的HTTP交互
- 导演桥接与工具适配：将适配器输出桥接到流式管道，并将外部工具暴露给模型

章节来源
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)
- [model-routing.ts](file://src/features/ai/model-routing.ts)
- [openai-compatible-payloads.ts](file://src/features/ai/openai-compatible-payloads.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)
- [mimo-audio-client.ts](file://src/features/audio/mimo-audio-client.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)

## 架构总览
下图展示了从上层调用到Mimo API的完整链路，包含鉴权、消息构建、流式响应、错误处理与降级路径。

```mermaid
sequenceDiagram
participant Caller as "调用方"
participant Router as "模型路由"
participant Adapter as "Mimo适配器"
participant OAICfg as "OpenAI兼容配置"
participant HTTP as "HTTP客户端"
participant Stream as "流式桥接"
participant Tool as "工具适配"
Caller->>Router : 选择Mimo模型
Router-->>Adapter : 返回适配器实例
Adapter->>OAICfg : 合并配置(超时/重试/模型参数)
Adapter->>HTTP : 发起请求(含鉴权头)
HTTP-->>Adapter : 返回流式响应
Adapter->>Stream : 解析增量片段
Stream-->>Caller : 推送增量结果
Adapter->>Tool : 触发工具调用(可选)
Tool-->>Adapter : 返回工具结果
Adapter-->>Caller : 最终结果/错误
```

图表来源
- [model-routing.ts](file://src/features/ai/model-routing.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)

## 详细组件分析

### 认证流程
- 鉴权方式：通过请求头注入API密钥（例如Authorization或自定义Header），由适配器在每次请求前组装
- 凭据来源：优先从环境变量或配置中心加载，支持动态刷新
- 安全建议：避免在日志中打印敏感信息；对密钥进行最小权限控制

```mermaid
flowchart TD
Start(["开始"]) --> LoadCfg["加载Mimo配置"]
LoadCfg --> HasKey{"存在有效密钥?"}
HasKey --> |否| ErrNoKey["抛出凭据缺失错误"]
HasKey --> |是| BuildHeaders["构建鉴权头"]
BuildHeaders --> Request["发起HTTP请求"]
Request --> Resp{"响应状态码"}
Resp --> |401/403| HandleAuthErr["认证失败处理(重试/降级)"]
Resp --> |2xx| Success["继续后续处理"]
HandleAuthErr --> End(["结束"])
Success --> End
```

图表来源
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [route-contract-error.ts](file://src/features/ai/route-contract-error.ts)

章节来源
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [route-contract-error.ts](file://src/features/ai/route-contract-error.ts)
- [credentials.md](file://docs/configuration/credentials.md)

### 消息格式与多模态输入
- 消息结构：遵循OpenAI兼容的消息格式（角色、内容、附件等），适配器负责转换为Mimo期望的载荷
- 多模态：支持文本、图片、音频等多类型输入，适配器根据媒体类型进行编码与上传
- 工具定义：以结构化Schema描述工具，供模型在生成过程中调用

```mermaid
classDiagram
class Message {
+string role
+any content
+Attachment[] attachments
}
class Attachment {
+string type
+string url
+string mime_type
+number size_bytes
}
class ToolDefinition {
+string name
+string description
+object parameters
}
class Payload {
+Message[] messages
+ToolDefinition[] tools
+object options
}
Message --> Attachment : "包含"
Payload --> Message : "包含"
Payload --> ToolDefinition : "包含"
```

图表来源
- [openai-compatible-payloads.ts](file://src/features/ai/openai-compatible-payloads.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)

章节来源
- [openai-compatible-payloads.ts](file://src/features/ai/openai-compatible-payloads.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)

### 流式响应处理
- 流式读取：适配器接收服务端增量数据，解析后通过桥接器推送到上游
- 增量拼接：前端或调用方可实时渲染，提升用户体验
- 中断与取消：支持在需要时中止流式传输，释放资源

```mermaid
sequenceDiagram
participant Client as "调用方"
participant Adapter as "Mimo适配器"
participant StreamBridge as "流式桥接"
participant Server as "Mimo服务端"
Client->>Adapter : 发送请求(启用流式)
Adapter->>Server : 建立SSE/流式连接
Server-->>Adapter : 推送增量片段
Adapter->>StreamBridge : 解析并转发片段
StreamBridge-->>Client : 实时渲染
Note over Adapter,Server : 可支持取消/超时/重试
```

图表来源
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)

章节来源
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)

### 工具调用与函数执行
- 工具发现：适配器根据配置加载工具定义，并在响应中携带调用指令
- 执行流程：调用方执行工具函数，将结果回传给适配器，适配器继续生成后续内容
- 错误隔离：工具执行异常不影响主流程，适配器可记录并降级

```mermaid
flowchart TD
Start(["开始"]) --> GenMsg["模型生成消息"]
GenMsg --> HasToolCall{"是否包含工具调用?"}
HasToolCall --> |否| Return["直接返回结果"]
HasToolCall --> |是| ExecTool["执行工具函数"]
ExecTool --> ToolOk{"执行成功?"}
ToolOk --> |否| HandleErr["记录错误并降级"]
ToolOk --> |是| FeedBack["将结果反馈给模型"]
HandleErr --> Continue["继续生成"]
FeedBack --> Continue
Continue --> Return
```

图表来源
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)

章节来源
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)

### 配置管理
- 凭据设置：API密钥、基础URL、组织ID等
- 模型参数：温度、最大长度、TopP、频率惩罚等
- 超时与重试：请求超时、连接超时、重试次数与退避策略
- 环境加载：从环境变量或配置文件加载，支持运行时覆盖

```mermaid
classDiagram
class MimoConfig {
+string apiKey
+string baseUrl
+number timeoutMs
+number retryCount
+object modelParams
+validate() bool
}
class OpenAICfg {
+string provider
+object headers
+object options
}
class RuntimeEnv {
+loadEnv() void
+get(key) string
}
MimoConfig --> OpenAICfg : "映射"
OpenAICfg --> RuntimeEnv : "读取"
```

图表来源
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)

章节来源
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)
- [credentials.md](file://docs/configuration/credentials.md)

### 音频能力（Mimo TTS）
- 功能范围：文本转语音、音色选择、语速控制、音频格式输出
- 调用流程：构造音频请求，发送后获取流式或二进制音频数据
- 错误处理：网络异常、限流、解码失败的兜底策略

```mermaid
sequenceDiagram
participant App as "应用"
participant AudioClient as "Mimo音频客户端"
participant Server as "Mimo音频服务"
App->>AudioClient : 提交TTS请求(文本/音色/格式)
AudioClient->>Server : 发起音频合成请求
Server-->>AudioClient : 返回音频流/二进制
AudioClient-->>App : 播放/保存/转码
```

图表来源
- [mimo-audio-client.ts](file://src/features/audio/mimo-audio-client.ts)

章节来源
- [mimo-audio-client.ts](file://src/features/audio/mimo-audio-client.ts)

## 依赖关系分析
- 适配器依赖OpenAI兼容层进行载荷构造与配置映射
- 路由与注册模块决定何时使用Mimo适配器
- 流式桥接与工具适配将适配器能力融入工作流
- 音频客户端独立于文本适配器，但共享配置与错误处理策略

```mermaid
graph LR
Reg["provider-registry.ts"] --> Rout["model-routing.ts"]
Rout --> Ada["mimo-adapter.ts"]
Ada --> OAP["openai-compatible-payloads.ts"]
Ada --> OAC["openai-compatible-config.ts"]
Ada --> Str["pi-stream-bridge.ts"]
Ada --> Tool["pi-tool-adapter.ts"]
Ada --> Aud["mimo-audio-client.ts"]
```

图表来源
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)
- [model-routing.ts](file://src/features/ai/model-routing.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [openai-compatible-payloads.ts](file://src/features/ai/openai-compatible-payloads.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)
- [mimo-audio-client.ts](file://src/features/audio/mimo-audio-client.ts)

章节来源
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)
- [model-routing.ts](file://src/features/ai/model-routing.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [openai-compatible-payloads.ts](file://src/features/ai/openai-compatible-payloads.ts)
- [openai-compatible-config.ts](file://src/features/ai/openai-compatible-config.ts)
- [pi-stream-bridge.ts](file://src/features/director/pi-stream-bridge.ts)
- [pi-tool-adapter.ts](file://src/features/director/pi-tool-adapter.ts)
- [mimo-audio-client.ts](file://src/features/audio/mimo-audio-client.ts)

## 性能考量
- 连接复用：保持HTTP连接池，减少握手开销
- 流式优先：尽量使用流式响应降低首字节延迟
- 缓存策略：对静态配置与模型元数据进行本地缓存
- 并发控制：限制并发请求数，避免触发服务端限流
- 压缩与分块：合理设置请求体大小与分块传输

[本节为通用指导，不直接分析具体文件]

## 故障排查指南
- 认证失败：检查API密钥有效性、网络可达性、代理设置
- 限流与超时：调整重试次数与退避策略，增加超时阈值
- 流式中断：确认服务端支持SSE/流式，检查客户端取消逻辑
- 工具执行异常：验证工具函数签名与返回值，记录错误上下文
- 降级策略：当Mimo不可用时，切换到备用Provider或返回默认响应

章节来源
- [route-contract-error.ts](file://src/features/ai/route-contract-error.ts)
- [mimo-adapter.ts](file://src/features/ai/mimo-adapter.ts)
- [mimo-config.ts](file://src/features/ai/mimo-config.ts)

## 结论
Mimo适配器通过统一的接口与OpenAI兼容层，简化了与Mimo API的集成。结合流式响应、工具调用与音频能力，可在复杂工作流中提供稳定高效的AI服务。合理的配置管理与错误处理策略是保障生产稳定性的关键。

[本节为总结性内容，不直接分析具体文件]

## 附录
- 集成步骤
  - 配置凭据与环境变量
  - 注册Provider并选择模型
  - 构建消息与工具定义
  - 启用流式响应与错误处理
- 测试方法
  - 单元测试：模拟网络与流式数据
  - 集成测试：端到端调用Mimo API
  - 性能测试：压测流式吞吐与延迟
- 最佳实践
  - 最小权限原则管理密钥
  - 监控与告警关键指标
  - 定期更新模型参数与配置

[本节为操作指南，不直接分析具体文件]