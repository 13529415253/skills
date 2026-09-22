#!/usr/bin/env bash
#
# sync-to-agents.sh — 单向同步 pi 配置根源到 ~/.agents/skills（共享给其它 agent）
#
# 作者：fang
# 根源（source of truth）：本仓库，即 /Users/gcf/.pi/agent
# 目标：~/.agents/skills
#
# 用法：
#   bin/sync-to-agents.sh          # dry-run，仅预览差异，不写文件
#   bin/sync-to-agents.sh --apply  # 实际写入目标 SKILL.md
#
# frontmatter 规则：
#   - 源无 frontmatter（如 AGENTS.md）：整体生成 name + description
#   - 源有 frontmatter 但缺 name/description：自动补齐，其余原样保留
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENTS_SKILLS="${HOME}/.agents/skills"

APPLY=0
case "${1:-}" in
  "")        ;;
  --apply)   APPLY=1 ;;
  *)         echo "用法: $(basename "$0") [--apply]" >&2; exit 2 ;;
esac

# sync_one <源相对路径> <目标目录名> <skill name> <源无 description 时的兜底描述>
sync_one() {
  local src_rel="$1" target_dirname="$2" skill_name="$3" fallback_desc="$4"
  local src="${ROOT}/${src_rel}"
  local target_dir="${AGENTS_SKILLS}/${target_dirname}"
  local target="${target_dir}/SKILL.md"

  if [[ ! -f "$src" ]]; then
    echo "!! 源文件不存在: $src" >&2
    return 1
  fi

  local tmp
  tmp="$(mktemp)"

  if [[ "$(head -n 1 "$src")" == "---" ]]; then
    # 源已有 frontmatter：仅补齐缺失的 name / description
    awk -v name="${skill_name}" -v desc="${fallback_desc}" '
      BEGIN { fm = 0; has_name = 0; has_desc = 0 }
      NR == 1 && $0 == "---" { fm = 1; print; next }
      fm == 1 && $0 == "---" {
        if (!has_name) print "name: " name;
        if (!has_desc) print "description: " desc;
        fm = 2; print; next
      }
      fm == 1 {
        if ($0 ~ /^name:[[:space:]]*/)         has_name = 1;
        if ($0 ~ /^description:[[:space:]]*/)  has_desc = 1;
        print; next
      }
      { print }
    ' "$src" > "$tmp"
  else
    # 源无 frontmatter：整体生成
    {
      printf -- '---\n'
      printf 'name: %s\n' "$skill_name"
      printf 'description: %s\n' "$fallback_desc"
      printf -- '---\n\n'
      cat "$src"
    } > "$tmp"
  fi

  if [[ -f "$target" ]] && cmp -s "$target" "$tmp"; then
    echo "== 无变化: ${target/#$HOME/~}"
    rm -f "$tmp"
    return 0
  fi

  echo "== 源: ${src_rel}"
  echo "   目标: ${target/#$HOME/~}"
  if [[ -f "$target" ]]; then
    diff -u "$target" "$tmp" || true
  else
    echo "   (目标不存在，将新建)"
    sed 's/^/   + /' "$tmp"
  fi
  echo

  if [[ "$APPLY" -eq 1 ]]; then
    mkdir -p "$target_dir"
    cp "$tmp" "$target"
    echo "   已写入: ${target/#$HOME/~}"
  fi
  rm -f "$tmp"
}

sync_one "AGENTS.md" \
  "common-guide" \
  "common-guide" \
  "fang 全局开发准则总纲：中文思考与输出、署名、团队项目技术栈、公用组件规范、计划模式、Vue/接口/前端代码规范、Git 权限、同类点排查、决策矩阵、提测验证与 Orca 浏览器。适用于所有开发任务。"

sync_one "prompts/plan-start.md" \
  "plan-start" \
  "start-plan" \
  "进入计划模式（分片完整档）：建分片计划、零售式讨论、状态落盘，授权后逐步实施"

if [[ "$APPLY" -eq 0 ]]; then
  echo "（dry-run）未写入任何文件；确认无误后执行: bin/sync-to-agents.sh --apply"
else
  echo "同步完成。"
fi
