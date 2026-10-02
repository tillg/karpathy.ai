#!/usr/bin/env bash
# Spike 01: clone modes vs disk usage, and whether the backend's git operations still work.
#
# Run:  bash specs/research/prod-env/spikes/01-clone-modes.sh [SRC_REPO] [WORK_DIR] 2>&1 | tee specs/research/prod-env/spikes/01-clone-modes.out.txt
#   SRC_REPO  default /Users/tgartner/git/mylife_wiki (read only: it is copied, never touched)
#   WORK_DIR  default $TMPDIR/karpathy-disk-spike (deleted at the end)
# ONLY=E runs just the variants whose name starts with E.
# Needs ~2x the source repo's pack size + its working tree of free disk (the variants run one at a time).
#
# What it does: makes a bare "server" copy (file://, --no-local, uploadpack.allowFilter on, like GitHub),
# then for each clone mode: clone, measure time + .git + working-tree size, and replay the backend's
# git calls (apps/backend/src/repo.ts): status, diff HEAD, diff --stat, cat-file -e, stash push/pop,
# the pull procedure (fetch, merge-base --is-ancestor, stash, merge --ff-only, stash pop), add -A,
# commit, push. An upstream commit is pushed by a separate tiny clone before the pull.
set -u
SRC=${1:-/Users/tgartner/git/mylife_wiki}
WORK=${2:-${TMPDIR:-/tmp}/karpathy-disk-spike}
BRANCH=main
MD_FILE=README.md           # a tracked .md file at the repo root (edited by the "upstream" pusher)
now() { perl -MTime::HiRes=time -e 'printf "%.1f", time'; }
kb() { du -sk "$1" 2>/dev/null | awk '{print $1}'; }
mb() { awk -v k="$1" 'BEGIN{printf "%.0f MB", k/1024}'; }

rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK" || exit 1
echo "# spike 01 — $(date '+%Y-%m-%d %H:%M') — git $(git --version | awk '{print $3}') — src $SRC"
t0=$(now)
git clone -q --bare --no-local "$SRC" server.git
git -C server.git config uploadpack.allowFilter true
git -C server.git config uploadpack.allowAnySHA1InWant true
echo "bare server copy: $(mb "$(kb server.git)")  ($(awk -v a="$t0" -v b="$(now)" 'BEGIN{printf "%.1f", b-a}') s)"
URL="file://$WORK/server.git"

# A tiny clone that pushes one upstream commit (so the variant has something to pull).
push_upstream() {
  rm -rf pusher
  git clone -q --filter=blob:none --no-checkout "$URL" pusher &&
    git -C pusher sparse-checkout set --no-cone "/$MD_FILE" &&
    git -C pusher checkout -q "$BRANCH" &&
    echo "upstream line $(date +%s)" >> "pusher/$MD_FILE" &&
    git -C pusher -c user.name=spike -c user.email=spike@x commit -qam "upstream change" &&
    git -C pusher push -q origin "HEAD:refs/heads/$BRANCH"
  local rc=$?; rm -rf pusher; return $rc
}

ok() { local name=$1; shift; if "$@" >/dev/null 2>"$WORK/err"; then printf '    %-28s OK\n' "$name"; else printf '    %-28s FAIL: %s\n' "$name" "$(head -c 300 "$WORK/err" | tr '\n' ' ')"; fi; }

variant() {
  local name=$1 post=$2; shift 2
  if [ -n "${ONLY:-}" ] && [[ "$name" != ${ONLY}* ]]; then return; fi
  local d="$WORK/v"; rm -rf "$d"
  echo; echo "## $name"; echo "   git clone $*"
  local a; a=$(now)
  if ! git clone -q --branch "$BRANCH" "$@" "$URL" "$d" 2>"$WORK/err"; then echo "   clone FAILED: $(cat "$WORK/err")"; return; fi
  if [ -n "$post" ]; then (cd "$d" && eval "$post") || echo "   post-clone step FAILED"; fi
  local secs; secs=$(awk -v a="$a" -v b="$(now)" 'BEGIN{printf "%.1f", b-a}')
  local g t files; g=$(kb "$d/.git"); t=$(kb "$d"); files=$(cd "$d" && find . -path ./.git -prune -o -type f -print | wc -l | tr -d ' ')
  echo "   time ${secs} s | .git $(mb "$g") | working tree $(mb $((t-g))) | total $(mb "$t") | files on disk $files"
  local md; md=$(cd "$d" && git ls-files -- '*.md' | grep -v "^$MD_FILE$" | head -1)
  cd "$d" || return
  git config user.name spike; git config user.email spike@x
  # Unique names per variant: earlier variants push their new files to the shared server copy.
  local tag=${name%% *}
  echo "local edit" >> "$md"; echo "# new note" > "spike-new-note-$tag.md"
  mkdir -p "Sources/spike-$tag" && head -c 2048 /dev/urandom > "Sources/spike-$tag/new-image.png"
  echo "   backend operations (edited $md, new .md, new binary under Sources/):"
  ok "status --untracked=all" git status --porcelain=v1 -z --untracked-files=all -- .
  ok "diff HEAD -- file" git diff HEAD -- "$md"
  ok "diff HEAD --stat" git diff HEAD --stat -- .
  ok "cat-file -e HEAD:file" git cat-file -e "HEAD:$md"
  ok "stash push -u + pop" sh -c 'git stash push -q --include-untracked -m t && git stash pop -q'
  ok "upstream commit pushed" push_upstream
  ok "pull: fetch" git fetch -q origin "$BRANCH"
  ok "pull: merge-base" git merge-base --is-ancestor HEAD "origin/$BRANCH"
  ok "pull: stash push -u" git stash push -q --include-untracked -m karpathy-app-pull
  ok "pull: merge --ff-only" git merge -q --ff-only "origin/$BRANCH"
  ok "pull: stash pop" git stash pop -q
  ok "add -A + commit" sh -c 'git add -A -- . && git commit -qm "local change"'
  ok "new binary committed" git ls-files --error-unmatch "Sources/spike-$tag/new-image.png"
  echo "    still uncommitted after commit: $(git status --porcelain --untracked-files=all | tr '\n' ' ')"
  ok "push" git push -q origin "HEAD:refs/heads/$BRANCH"
  ok "log -3 (history)" git log -3 --format=%h
  local g2; g2=$(kb "$d/.git")
  echo "   .git after ops: $(mb "$g2")"
  git count-objects -vH | sed 's/^/   | /' | grep -E 'size-pack|count:|in-pack'
  cd "$WORK" || exit 1; rm -rf "$d"
}

variant "A full clone" ""
variant "B shallow --depth 1" "" --depth 1
variant "C partial --filter=blob:none" "" --filter=blob:none
variant "D partial --filter=blob:limit=1m" "" --filter=blob:limit=1m
variant "E blob:none + sparse, only *.md (non-cone)" "git sparse-checkout set --no-cone '*.md'" --filter=blob:none --sparse
variant "F blob:none + sparse cone on root subfolder Wiki/" "git sparse-checkout set Wiki" --filter=blob:none --sparse
variant "G blob:none + sparse, everything except video (non-cone)" "git sparse-checkout set --no-cone '/*' '!*.mp4' '!*.mov' '!*.m4v' '!*.webm'" --filter=blob:none --sparse
variant "H shallow --depth 1 + blob:none + sparse *.md" "git sparse-checkout set --no-cone '*.md'" --depth 1 --filter=blob:none --sparse

cd / && rm -rf "$WORK"
echo; echo "cleaned up $WORK"
