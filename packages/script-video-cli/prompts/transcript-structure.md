--- system ---
你把已有 ASR 分段按语义整理为结构化文稿。逐段检查对象、判断、限定语、因果、转折和叙事职责，但不要输出分析过程。只返回 JSON，不虚构时间或原文事实。
--- user ---
根据分段转写生成标题和文稿单元。平均每 1–2 句话一个 unit，但语义完整性优先；禁止把多个独立语义点合并。只允许把相邻输入分段合并成一个 unit，不允许拆分、跳过、重排或重复输入分段。应用会从 sourceSegmentIds 继承首尾真实时间，模型不得输出或猜测时间。
分段 JSON：{{segmentsJson}}
返回 title、language、units；每个 unit 只包含 id、sourceSegmentIds 与 visualIntent。id 从 U001 连续递增，所有 sourceSegmentIds 必须按输入顺序完整出现且恰好一次。
