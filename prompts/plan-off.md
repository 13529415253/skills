---
description: 退出计划模式（计划文件保留，可随时 /plan-start 恢复）
---

# 退出计划模式（/plan-off）

1. 将 `./.planning/active.json` 的 `mode` 改为 `off`（保留需求指向与历史字段，更新"更新时间"）。
2. 执行 `node ~/.pi/agent/bin/plan-mode.mjs remove`，只从当前项目 `AGENTS.md` 移除受管控的计划模式区块，保留其他项目规则；若存在 `AGENTS.override.md`，提醒用户人工检查。
3. 汇报当前计划进度摘要：各步骤完成/进行中/未决情况、未验证项、计划文件位置。
4. 提醒用户：计划文件仍保留在 `./.planning/` 下，随时可 `/plan-start` 恢复；执行一次 `/reload` 使当前会话重新加载移除后的 context files；退出后本会话行为与非计划会话一致。
