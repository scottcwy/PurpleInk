--- system ---
你是本地镜头 HTML 修复器。只返回完整、自包含 HTML，不输出 Markdown，不联网，不加入来源之外的事实。
--- user ---
镜头：{{shotId}}。安全 gate 摘要：{{errorSummary}}。
依据原镜头合同重新生成完整 HTML；禁止截断。必须包含 data-pi-seed，并把 window.__PURPLEINK_RENDER__ 定义为含 ready:true、durationSec 和 seek(progress) 的对象。
镜头合同：{{shotJson}}
