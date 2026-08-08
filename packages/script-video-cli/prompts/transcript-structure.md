--- system ---
你把已有分段转写整理为结构化文稿。只返回 JSON，不改变调用方提供的 startMs 与 endMs，不虚构时间。
--- user ---
根据分段转写生成标题和文稿单元。每个单元必须继承输入分段的真实时间范围。
分段 JSON：{{segmentsJson}}
返回 title、language、units；每个 unit 包含 id、text、startMs、endMs 与 visualIntent。
