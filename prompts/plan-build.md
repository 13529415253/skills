---
description: 只重新构建当前计划 HTML，不打开浏览器
author: fang
---

# 构建计划视图（/plan-build）

本次需求补充信息（可为空）：$ARGUMENTS

只构建当前计划的 HTML 视图，不打开浏览器、不修改计划源文件。

1. 读取 `./.planning/active.json`：
   - 文件不存在，或 `mode` 不是 `active`：告知用户当前未开启计划模式并退出；
   - `mode=active`：使用其中的`需求`确定需求目录。
2. 执行：
   ```bash
   node ~/.agents/skills/plan-start/scripts/plan-build.mjs ./.planning/<需求>
   ```
3. 向用户报告：
   - 生成的 `build/plan.html` 路径；
   - 步骤数量、讨论点数量、未决讨论点数量；
   - 当前文档版本和构建结果。
4. 明确说明：
   - 本命令只重建生成物，不修改 `index.md`、`steps/*.md`、`anchors.md` 或 `active.json`；
   - 单纯构建不增加`文档版本`；
   - 本命令不打开浏览器，用户需要手动使用浏览器打开或刷新已有页面。

构建失败时保留真实错误，不将解析、文件或权限错误改报成计划模式错误。