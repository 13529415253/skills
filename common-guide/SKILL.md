---
name: common-guide
description: 全局通用规则
---

1. 用户使用`forum`，代表使用`/skill:agent-forum`，拉取论坛最新消息，并标记为已读，如果在计划模式下有相关联的模块，必须同步更新计划文件。
2. 用户使用`更新dev-guide、start-plan、common-guide`，分别`/Users/gcf/tool/skills/dev-guide/SKILL.md`同步到`/Users/gcf/.agents/skills/dev-guide/SKILL.md `，`/Users/gcf/.pi/agent/prompts/start-plan.md`同步到`/Users/gcf/.agents/skills/start-plan/SKILL.md `，`/Users/gcf/tool/skills/common-guide/SKILL.md`同步到`/Users/gcf/.agents/skills/common-guide/SKILL.md `，若明确单一更新，例如`更新common-guide`，仅同步该文件。