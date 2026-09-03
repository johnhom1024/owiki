#!/usr/bin/env bash
# 本地打发版 tag。只写 git tag，不 push——推远程必须你明确说。
#
# 用法:
#   ./scripts/tag.sh                 列出近期 tag
#   ./scripts/tag.sh list
#   ./scripts/tag.sh beta            基于最新正式版，提议下一个 vX.Y.(Z+1)-beta.N
#   ./scripts/tag.sh beta 0.0.3      指定系列（已有 beta.1 则提议 beta.2）
#   ./scripts/tag.sh release         提议下一个正式版 vX.Y.(Z+1)
#   ./scripts/tag.sh release 0.1.0   指定正式版号
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git rev-parse --is-inside-work-tree >/dev/null

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \?//'
  exit 1
}

# 全部 v* tag，版本号倒序（含预发布）
all_tags() {
  git tag -l 'v*' --sort=-v:refname
}

# 正式版：vX.Y.Z，不含连字符
stable_tags() {
  all_tags | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true
}

latest_stable() {
  local tags
  tags="$(stable_tags)"
  [[ -z "$tags" ]] && return 0
  printf '%s\n' "$tags" | awk 'NR==1'
}

# 某系列下已有的 beta.N（stdout 一行一个完整 tag，新→旧）
beta_tags_of() {
  local series="$1" # 0.0.3
  all_tags | grep -E "^v${series//./\\.}-beta\.[0-9]+$" || true
}

tag_exists() {
  git show-ref --tags --quiet --verify "refs/tags/$1"
}

bump_patch() {
  local ver="${1#v}" # 0.0.2
  local major minor patch
  IFS=. read -r major minor patch <<<"$ver"
  echo "${major}.${minor}.$((patch + 1))"
}

# 1.2.3-beta.4 → 4；没有匹配则空
beta_n() {
  local tag="$1"
  [[ "$tag" =~ -beta\.([0-9]+)$ ]] && echo "${BASH_REMATCH[1]}"
}

confirm_tag() {
  local tag="$1"
  local head
  head="$(git rev-parse --short HEAD)"

  if tag_exists "$tag"; then
    echo "tag $tag 已存在（$(git rev-parse --short "$tag")），未改动。" >&2
    exit 1
  fi

  echo
  echo "即将在 HEAD ${head} 打 tag："
  echo "  git tag ${tag}"
  echo
  if [[ "$tag" == *-* ]]; then
    echo "镜像钉死为 johnhom1024/owiki:${tag#v}（不更新 :latest）"
  else
    echo "镜像钉死为 johnhom1024/owiki:${tag#v}，并更新 :latest"
  fi
  echo "本脚本不 push。确认后再："
  echo "  git push origin ${tag}"
  echo
  read -r -p "打这个 tag？[y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "已取消。"; exit 0 ;;
  esac

  git tag "$tag"
  echo "已打 ${tag} @ ${head}"
  echo "推远程：git push origin ${tag}"
}

cmd_list() {
  local latest
  latest="$(latest_stable)"
  if [[ -z "$latest" ]]; then
    echo "还没有任何正式版 tag。"
    echo "现有 v* tag："
    local existing
    existing="$(all_tags)"
    if [[ -z "$existing" ]]; then
      echo "  （无）"
    else
      echo "$existing" | sed 's/^/  /'
    fi
    return
  fi

  echo "正式版（最新 ${latest}）："
  stable_tags | sed 's/^/  /'
  echo

  local series="${latest#v}"
  local next
  next="$(bump_patch "$latest")"

  echo "进行中的预发布："
  local betas
  betas="$(all_tags | grep -- '-beta\.' || true)"
  if [[ -z "$betas" ]]; then
    echo "  （无）"
  else
    echo "$betas" | sed 's/^/  /'
  fi
  echo
  echo "下一步建议："
  echo "  ./scripts/tag.sh beta              → v${next}-beta.N"
  echo "  ./scripts/tag.sh release           → v${next}"
}

cmd_beta() {
  local series="${1:-}"
  local latest
  latest="$(latest_stable)"

  if [[ -z "$series" ]]; then
    if [[ -z "$latest" ]]; then
      echo "还没有正式版 tag，请指定系列： ./scripts/tag.sh beta 0.0.1" >&2
      exit 1
    fi
    series="$(bump_patch "$latest")"
  fi

  if [[ ! "$series" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "系列号格式应为 X.Y.Z，收到：${series}" >&2
    exit 1
  fi

  # 正式版已发出则拒绝再打该系列 beta（避免 0.0.2 已发还出 0.0.2-beta.1）
  if tag_exists "v${series}"; then
    echo "正式版 v${series} 已存在，不能再打该系列的 beta。" >&2
    echo "若要测下一版： ./scripts/tag.sh beta $(bump_patch "v${series}")" >&2
    exit 1
  fi

  local last n=0 existing
  existing="$(beta_tags_of "$series")"
  if [[ -n "$existing" ]]; then
    last="$(printf '%s\n' "$existing" | awk 'NR==1')"
    n="$(beta_n "$last")"
  fi
  local next="v${series}-beta.$((n + 1))"

  echo "系列 ${series}"
  echo "  最新正式版： ${latest:-（无）}"
  echo "  已有 beta："
  local existing
  existing="$(beta_tags_of "$series")"
  if [[ -z "$existing" ]]; then
    echo "    （无）"
  else
    echo "$existing" | sed 's/^/    /'
  fi
  echo "  提议：       ${next}"

  confirm_tag "$next"
}

cmd_release() {
  local ver="${1:-}"
  local latest
  latest="$(latest_stable)"

  if [[ -z "$ver" ]]; then
    if [[ -z "$latest" ]]; then
      echo "还没有正式版 tag，请指定版本： ./scripts/tag.sh release 0.0.1" >&2
      exit 1
    fi
    ver="$(bump_patch "$latest")"
  fi

  if [[ ! "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "版本号格式应为 X.Y.Z，收到：${ver}" >&2
    exit 1
  fi

  local tag="v${ver}"
  echo "  最新正式版： ${latest:-（无）}"
  echo "  该系列 beta："
  local existing
  existing="$(beta_tags_of "$ver")"
  if [[ -z "$existing" ]]; then
    echo "    （无）"
  else
    echo "$existing" | sed 's/^/    /'
  fi
  echo "  提议：       ${tag}  （会更新 :latest）"

  confirm_tag "$tag"
}

cmd="${1:-list}"
shift || true
case "$cmd" in
  list|-h|--help) cmd_list ;;
  beta)           cmd_beta "${1:-}" ;;
  release)        cmd_release "${1:-}" ;;
  *)              usage ;;
esac
