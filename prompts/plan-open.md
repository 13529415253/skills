---
description: 在浏览器打开当前计划的可视化视图（非阻塞，使用浏览器刷新）
---

# 打开计划视图（/plan-open）

在浏览器打开当前计划的可视化 html。**本命令不阻塞会话**，用户可一边看计划一边继续对话。

1. 读 `./.planning/active.json` 确定当前需求目录；未开启计划模式则提示先 `/plan-start`，并退出。
2. 执行构建（等价于 `/plan-build`）：`node ~/.agents/skills/plan-start/scripts/plan-build.mjs ./.planning/<需求>`，生成 `build/plan.html`。
3. 用系统默认浏览器打开（按 `uname` 判断：macOS 用 `open`，Linux 用 `xdg-open`），命令立即返回。
4. 告知用户：
   - 页面不再提供自定义刷新按钮，也不保存滚动位置或折叠状态；需要更新时使用浏览器原生刷新，避免自定义刷新造成阅读位置跳转；
   - AI 每次写回计划后会重新执行构建，浏览器刷新后最近变更的讨论点会黄色高亮；
   - 顶部有待讨论点聚合表（未决在前），点击左侧目录可跳转到任意步骤。
