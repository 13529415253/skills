---
description: 进入计划模式（分片完整档）：建分片计划、零售式讨论、状态落盘、UI 设计基线
argument-hint: "[需求描述或需求文件路径]"
name: plan-start
---

# 进入计划模式（/plan-start）

本次需求补充信息（可为空）：$ARGUMENTS

本文件只是入口薄壳，**唯一实现源**为 `~/.agents/skills/plan-start/SKILL.md`（pi、Claude Code、Codex、Cursor 共用）。

1. 先完整读取 `~/.agents/skills/plan-start/SKILL.md`，严格按其协议执行：启用判定、责任矩阵、分片计划结构、`待讨论界面设计`、`界面设计基线`、批次 Review、门禁与写回规则全部以该文件为准。
2. 需要核心规则时读 `~/.agents/skills/plan-start/core/plan-core.md`；执行脚本一律使用 `~/.agents/skills/plan-start/scripts/`，不得引用其它路径。
3. 不要在 pi 与 `~/.agents` 之间维护第二套协议：本文件只做入口转发，协议改动只改 `~/.agents/skills/plan-start/`。
