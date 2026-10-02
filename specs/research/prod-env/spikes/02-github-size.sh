#!/usr/bin/env bash
# Spike 02: how well can the size of a vault be predicted BEFORE cloning it?
#
# Run:  bash specs/research/prod-env/spikes/02-github-size.sh [owner/repo ...] 2>&1 | tee specs/research/prod-env/spikes/02-github-size.out.txt
#   default repos: tillg/karpathy-app-test-vault tillg/mylife_wiki
# Needs: gh (authenticated), git. Read-only GitHub API calls only. The small repo is cloned to $TMPDIR and
# deleted; the big one is not cloned again (its real clone size comes from spike 01).
#
# Compares: REST `size` (KB, = GraphQL diskUsage), the recursive tree API (sum of blob sizes at HEAD,
# split into *.md vs the rest), and — for small repos — the real `git clone` size.
set -u
REPOS=("$@"); [ ${#REPOS[@]} -eq 0 ] && REPOS=(tillg/karpathy-app-test-vault tillg/mylife_wiki)
now() { perl -MTime::HiRes=time -e 'printf "%.2f", time'; }
echo "# spike 02 — $(date '+%Y-%m-%d %H:%M')"
for r in "${REPOS[@]}"; do
  echo; echo "## $r"
  a=$(now); meta=$(gh api "repos/$r" --jq '[.size, .default_branch, .pushed_at] | @tsv'); b=$(now)
  read -r size branch pushed <<<"$meta"
  echo "REST repos/$r .size = ${size} KB ($(awk -v k="$size" 'BEGIN{printf "%.1f MB", k/1024}'))  branch=$branch  pushed_at=$pushed  (call $(awk -v a="$a" -v b="$b" 'BEGIN{printf "%.2f", b-a}') s)"
  a=$(now)
  tree=$(gh api "repos/$r/git/trees/$branch?recursive=1" --jq '[.truncated, (.tree|length), ([.tree[]|select(.type=="blob")|.size]|add // 0), ([.tree[]|select(.type=="blob" and (.path|test("\\.md$";"i")))|.size]|add // 0), ([.tree[]|select(.type=="blob" and .size>1048576)]|length)] | @tsv')
  b=$(now)
  read -r trunc n blob md big <<<"$tree"
  echo "tree API: truncated=$trunc entries=$n blob bytes at HEAD=$blob ($(awk -v k="$blob" 'BEGIN{printf "%.1f MB", k/1048576}')) .md bytes=$md ($(awk -v k="$md" 'BEGIN{printf "%.1f MB", k/1048576}')) blobs>1MiB=$big  (call $(awk -v a="$a" -v b="$b" 'BEGIN{printf "%.2f", b-a}') s)"
  if [ "$size" -lt 51200 ]; then
    d=$(mktemp -d); a=$(now)
    git clone -q "https://github.com/$r.git" "$d/c" 2>&1 | head -3
    b=$(now)
    echo "real clone: $(du -sk "$d/c" | awk '{print $1}') KB total, .git $(du -sk "$d/c/.git" | awk '{print $1}') KB, size-pack $(git -C "$d/c" count-objects -v | awk '/size-pack/{print $2}') KB, du -sAk .git: $(du -sAk "$d/c/.git" 2>/dev/null | awk '{print $1}') KB apparent  ($(awk -v a="$a" -v b="$b" 'BEGIN{printf "%.1f", b-a}') s)"
    echo "files in .git: $(find "$d/c/.git" -type f | wc -l | tr -d ' ') (hooks samples etc. dominate a tiny repo)"
    rm -rf "$d"
  else
    echo "(not cloned: > 50 MB; see spike 01 for the measured clone)"
  fi
done
gh api rate_limit --jq '"rate limit core: \(.resources.core.remaining)/\(.resources.core.limit)"'
