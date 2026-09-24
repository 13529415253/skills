#!/usr/bin/env bash
#
# sync-to-agents.sh — 校验 pi 侧（软链/薄壳）与 ~/.agents/skills 唯一源的一致性
#
# 作者：fang
# 唯一源（source of truth）：~/.agents/skills
# 派生物：本仓库 pi 侧（软链 + 入口薄壳）
#
# 方向说明（两个 skill 均以 ~/.agents/skills 为唯一源）：
#   - common-guide：唯一规则源是 ~/.agents/skills/common-guide/SKILL.md，pi 的 AGENTS.md 为软链；
#   - plan-start：唯一实现源是 ~/.agents/skills/plan-start（协议 + core + scripts），pi 侧为软链 + 薄壳。
#   本脚本只做一致性校验，不再向 ~/.agents/skills 复制内容，避免覆盖唯一源。
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
# 说明：当前两个 skill 都以 ~/.agents/skills 为唯一源，脚本已不再调用本函数；保留供未来「pi 为源」的同步项使用。
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

# common-guide：唯一规则源在 ~/.agents/skills/common-guide，pi 的 AGENTS.md 是指向它的软链，只校验不复制。
check_common_guide() {
  local target="${AGENTS_SKILLS}/common-guide/SKILL.md"
  local link="${ROOT}/AGENTS.md"
  local ok=1

  if [[ ! -f "$target" ]]; then
    echo "!! 唯一规则源缺失: ${target/#$HOME/~}" >&2
    ok=0
  elif ! grep -q "^description:" "$target"; then
    echo "!! 唯一规则源缺少 skill frontmatter（description）: ${target/#$HOME/~}" >&2
    ok=0
  fi

  if [[ ! -L "$link" ]]; then
    echo "!! pi 的 AGENTS.md 应为软链: ${link/#$HOME/~}" >&2
    ok=0
  elif [[ "$(readlink "$link")" != "$target" ]]; then
    echo "!! 软链指向不符: ${link/#$HOME/~} -> $(readlink "$link")" >&2
    ok=0
  fi

  if [[ "$ok" -eq 1 ]]; then
    echo "== common-guide 唯一规则源与 pi 软链一致"
  fi
}

check_common_guide

# plan-start：唯一实现源在 ~/.agents/skills/plan-start，pi 侧为软链 + 薄壳，只校验不复制。
check_plan_start() {
  local skill_dir="${AGENTS_SKILLS}/plan-start"
  local ok=1
  local f link path want

  for f in SKILL.md scripts/plan-mode.mjs scripts/plan-build.mjs core/plan-core.md; do
    if [[ ! -f "${skill_dir}/${f}" ]]; then
      echo "!! 唯一实现源缺少: ${skill_dir}/${f}" >&2
      ok=0
    fi
  done

  if ! grep -q "~/.agents/skills/plan-start/SKILL.md" "${ROOT}/prompts/plan-start.md" 2>/dev/null; then
    echo "!! pi 薄壳未指向唯一实现源: prompts/plan-start.md" >&2
    ok=0
  fi

  for link in "${ROOT}/bin/plan-mode.mjs:scripts/plan-mode.mjs" \
              "${ROOT}/bin/plan-build.mjs:scripts/plan-build.mjs" \
              "${ROOT}/plan/plan-core.md:core/plan-core.md"; do
    path="${link%%:*}"
    want="${skill_dir}/${link##*:}"
    if [[ ! -L "$path" ]]; then
      echo "!! pi 侧应为软链: ${path/#$HOME/~}" >&2
      ok=0
    elif [[ "$(readlink "$path")" != "$want" ]]; then
      echo "!! 软链指向不符: ${path/#$HOME/~} -> $(readlink "$path")" >&2
      ok=0
    fi
  done

  if [[ "$ok" -eq 1 ]]; then
    echo "== plan-start 唯一源与 pi 薄壳一致"
  fi
}

check_plan_start

if [[ "$APPLY" -eq 0 ]]; then
  echo "（校验模式）本脚本当前只做一致性校验，不写入文件"
else
  echo "校验完成。"
fi
