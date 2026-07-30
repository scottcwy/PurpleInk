# Provider架构设计

<cite>
**本文档引用的文件**
- [provider-dispatch-window.ts](file://src/features/ai/provider-dispatch-window.ts)
- [provider-pool-control.ts](file://src/features/ai/provider-pool-control.ts)
- [provider-pool-policy.ts](file://src/features/ai/provider-pool-policy.ts)
- [provider-fairness.ts](file://src/features/ai/provider-fairness.ts)
- [provider-dispatch.ts](file://src/features/ai/provider-dispatch.ts)
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)
- [managed-gateway.ts](file://src/features/ai/managed-gateway.ts)
- [model-routing.ts](file://src/features/ai/model-routing.ts)
</cite>

## 更新摘要
**所做更改**
- 更新了Provider调度窗口逻辑，改进了与整体系统的集成
- 增强了提供商调度和分发功能
- 优化了池控制和策略管理机制
- 改进了公平性算法和负载均衡策略

## 目录
- [概述](#概述)
- [Provider模式核心概念](#provider模式核心概念)
- [调度窗口机制](#调度窗口机制)
- [池控制与策略管理](#池控制与策略管理)
- [公平性算法](#公平性算法)
- [配置管理系统](#配置管理系统)
- [路由策略实现](#路由策略实现)
- [扩展开发指南](#扩展开发指南)

## 概述

PurpleInk的Provider架构采用模块化设计，实现了统一的AI服务接口抽象、动态插件机制和适配器设计模式。该架构支持多种AI服务提供商的动态注册、调度和管理，提供了高可用性和可扩展性的AI服务访问层。

### 架构特点
- **统一接口抽象**：所有AI提供商都遵循相同的接口规范
- **动态插件机制**：支持运行时动态加载和卸载提供商
- **适配器模式**：不同提供商的API差异通过适配器进行封装
- **智能调度**：基于性能、成本和可用性进行智能路由决策

## Provider模式核心概念

### 统一接口定义
Provider模式的核心是定义统一的接口抽象，所有具体的AI服务提供商都需要实现这个接口：

```typescript
interface AIProvider {
  // 基础信息
  readonly id: string;
  readonly name: string;
  readonly version: string;
  
  // 能力检查
  supportsFeature(feature: ProviderFeature): boolean;
  
  // 请求处理
  invoke(request: AIRequest): Promise<AIResponse>;
  
  // 健康检查
  healthCheck(): Promise<boolean>;
  
  // 资源清理
  dispose(): Promise<void>;
}
```

### 适配器设计模式
适配器模式用于封装不同提供商的API差异，提供统一的调用接口：

- **OpenAI适配器**：适配OpenAI兼容的API格式
- **Gemini适配器**：适配Google Gemini API
- **StepFun适配器**：适配StepFun平台API
- **Mimo适配器**：适配Mimo媒体处理API

**章节来源**
- [provider-dispatch.ts](file://src/features/ai/provider-dispatch.ts)
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)

## 调度窗口机制

### 窗口计算逻辑
调度窗口机制负责管理Provider的调度和分发时间窗口，确保系统资源的合理分配：

#### 窗口类型
- **固定窗口**：基于固定时间间隔进行调度
- **滑动窗口**：基于滑动时间窗口进行负载平衡
- **自适应窗口**：根据系统负载动态调整窗口大小

#### 窗口参数配置
```typescript
interface DispatchWindowConfig {
  windowSize: number;        // 窗口大小（毫秒）
  maxConcurrentRequests: number;  // 最大并发请求数
  retryPolicy: RetryPolicy;   // 重试策略
  timeoutMs: number;         // 超时时间
}
```

### 窗口状态管理
调度窗口维护以下关键状态：
- **活跃请求计数**：当前正在处理的请求数量
- **队列长度**：等待处理的请求队列长度
- **错误率统计**：最近窗口的错误率统计
- **响应时间分布**：响应时间的统计信息

**章节来源**
- [provider-dispatch-window.ts](file://src/features/ai/provider-dispatch-window.ts)

## 池控制与策略管理

### 池控制器架构
池控制器负责管理Provider实例的生命周期和资源分配：

#### 池管理功能
- **实例创建**：按需创建Provider实例
- **实例销毁**：空闲时自动销毁实例
- **连接池**：复用数据库连接和HTTP连接
- **内存管理**：防止内存泄漏和过度占用

#### 池配置选项
```typescript
interface PoolConfig {
  minInstances: number;      // 最小实例数
  maxInstances: number;      // 最大实例数
  idleTimeout: number;       // 空闲超时时间
  acquireTimeout: number;    // 获取超时时间
  evictionPolicy: EvictionPolicy;  // 驱逐策略
}
```

### 策略管理系统
策略管理模块定义了不同的调度策略和负载均衡算法：

#### 支持的策略
- **轮询策略**：均匀分配请求到各个Provider
- **权重策略**：根据权重比例分配请求
- **最少连接策略**：选择连接数最少的Provider
- **响应时间策略**：选择响应最快的Provider
- **成本优化策略**：选择成本最低的Provider

**章节来源**
- [provider-pool-control.ts](file://src/features/ai/provider-pool-control.ts)
- [provider-pool-policy.ts](file://src/features/ai/provider-pool-policy.ts)

## 公平性算法

### 公平性保证机制
公平性算法确保多个用户或租户之间的资源公平分配：

#### 公平性指标
- **带宽公平性**：确保每个用户获得公平的带宽
- **延迟公平性**：避免某些用户长时间等待
- **优先级调度**：支持基于优先级的资源分配
- **配额管理**：限制每个用户的资源使用上限

#### 算法实现
```typescript
class FairnessAlgorithm {
  private userQuotas: Map<string, Quota>;
  private priorityQueue: PriorityQueue;
  private fairnessMetrics: FairnessMetrics;
  
  // 计算下一个应该被服务的用户
  selectNextUser(): string;
  
  // 更新公平性指标
  updateMetrics(userId: string, metrics: Metrics): void;
  
  // 检查是否违反公平性约束
  checkFairnessConstraints(): boolean;
}
```

### 多租户支持
公平性算法支持多租户场景下的资源隔离和配额管理：

- **租户隔离**：确保租户间的资源隔离
- **配额继承**：支持配额层级继承
- **动态调整**：根据使用情况动态调整配额
- **监控告警**：实时监控配额使用情况

**章节来源**
- [provider-fairness.ts](file://src/features/ai/provider-fairness.ts)

## 配置管理系统

### 配置结构
配置管理系统提供了灵活的配置结构和验证机制：

#### 配置层次结构
- **全局配置**：系统级默认配置
- **环境配置**：基于环境的配置覆盖
- **用户配置**：用户级别的个性化配置
- **运行时配置**：应用运行时的动态配置

#### 配置验证规则
```typescript
interface ConfigSchema {
  type: 'object';
  properties: {
    providerId: { type: 'string', required: true };
    apiKey: { type: 'string', minLength: 10 };
    rateLimit: { 
      type: 'number', 
      minimum: 1, 
      maximum: 1000 
    };
    timeout: {
      type: 'number',
      default: 30000
    };
  };
  required: ['providerId', 'apiKey'];
}
```

### 环境变量处理
系统支持多种环境变量配置方式：

- **配置文件**：JSON/YAML格式的配置文件
- **环境变量**：标准环境变量注入
- **密钥管理服务**：从安全的密钥管理服务获取敏感信息
- **远程配置**：支持从远程配置中心获取配置

**章节来源**
- [config.ts](file://src/features/ai/config.ts)

## 路由策略实现

### 路由决策引擎
路由策略引擎负责根据多种因素做出最优的路由决策：

#### 决策因素
- **Provider可用性**：检查Provider的健康状态
- **负载情况**：考虑各Provider的当前负载
- **成本因素**：选择成本最优的Provider
- **地理位置**：选择距离最近的Provider
- **历史性能**：基于历史表现进行选择

#### 路由策略配置
```typescript
interface RoutingStrategy {
  strategyType: 'weighted' | 'round-robin' | 'least-loaded' | 'performance-based';
  weights?: Record<string, number>;
  thresholds?: PerformanceThresholds;
  fallbackProviders?: string[];
}
```

### 故障转移机制
系统实现了完善的故障转移机制：

- **健康检查**：定期检查Provider的健康状态
- **快速失败**：检测到故障时立即切换到备用Provider
- **优雅降级**：在部分故障时提供降级服务
- **自动恢复**：当主Provider恢复时自动切换回来

**章节来源**
- [model-routing.ts](file://src/features/ai/model-routing.ts)
- [managed-gateway.ts](file://src/features/ai/managed-gateway.ts)

## 扩展开发指南

### 新Provider开发步骤

#### 1. 实现Provider接口
```typescript
class CustomProvider implements AIProvider {
  readonly id = 'custom-provider';
  readonly name = 'Custom AI Provider';
  readonly version = '1.0.0';
  
  async invoke(request: AIRequest): Promise<AIResponse> {
    // 实现具体的API调用逻辑
    const response = await this.callExternalAPI(request);
    return this.transformResponse(response);
  }
  
  async healthCheck(): Promise<boolean> {
    // 实现健康检查逻辑
    return await this.checkConnectivity();
  }
}
```

#### 2. 注册Provider
```typescript
// 在应用启动时注册新的Provider
const customProvider = new CustomProvider();
providerRegistry.register(customProvider);
```

#### 3. 配置Provider
```json
{
  "providers": {
    "custom-provider": {
      "enabled": true,
      "weight": 1.0,
      "rateLimit": 100,
      "timeout": 30000,
      "credentials": {
        "apiKey": "${CUSTOM_API_KEY}"
      }
    }
  }
}
```

### 最佳实践

#### 错误处理
- 实现详细的错误分类和日志记录
- 提供有意义的错误消息
- 实现重试机制和熔断器

#### 性能优化
- 实现连接池和请求缓存
- 使用异步处理和并行请求
- 实现合理的超时和限流策略

#### 安全考虑
- 敏感信息的加密存储
- API密钥的安全管理
- 请求和响应的安全验证

### 常见问题解决方案

#### 连接超时问题
- 调整超时配置参数
- 实现指数退避重试
- 添加连接池监控

#### 内存泄漏问题
- 正确释放资源
- 避免循环引用
- 使用内存分析工具检测

#### 负载均衡不均
- 调整权重配置
- 实现更智能的调度算法
- 监控各Provider的负载情况

**章节来源**
- [provider-dispatch.ts](file://src/features/ai/provider-dispatch.ts)
- [provider-registry.ts](file://src/features/ai/provider-registry.ts)