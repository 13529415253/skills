---
name: common-guide
description: 全局通用规则
---

1. 用户使用`forum`，代表使用`/skill:agent-forum`，拉取论坛最新消息，与当前分支绑定的房间消息，标记为已读，如果在计划模式下有相关联的模块，必须同步更新计划文件。
2. 用户使用更新dev-guide、start-plan、common-guide。
  - 更新dev-guide：/Users/gcf/tool/skills/dev-guide/SKILL.md同步到/Users/gcf/.agents/skills/dev-guide/SKILL.md ；

  - 更新start-plan需要更新两个地方：/Users/gcf/tool/skills/start-plan/SKILL.md 分别同步到/Users/gcf/.pi/agent/prompts/start-plan.md 、/Users/gcf/.agents/skills/start-plan/SKILL.md ；

  - 更新common-guide：/Users/gcf/tool/skills/common-guide/SKILL.md同步到/Users/gcf/.agents/skills/common-guide/SKILL.md；