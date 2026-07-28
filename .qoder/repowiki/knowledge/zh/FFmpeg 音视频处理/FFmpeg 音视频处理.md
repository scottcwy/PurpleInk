---
kind: external_dependency
name: FFmpeg 音视频处理
slug: ffmpeg
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - README.md
    - package.json
---

项目依赖 FFmpeg 和 ffprobe 进行音视频处理，通过 ffmpeg-static 包提供。用于音频时长测量、视频合成等媒体处理能力。需要系统级安装 FFmpeg 工具链。