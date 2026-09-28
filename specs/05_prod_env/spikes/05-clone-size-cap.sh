#!/usr/bin/env bash
# Spike 05: can a runaway clone be stopped at a size cap? git has no native "max clone size".
#
# Run:  bash specs/05_prod_env/spikes/05-clone-size-cap.sh [SRC_REPO] [WORK_DIR] [CAP_MB] 2>&1 | tee specs/05_prod_env/spikes/05-clone-size-cap.out.txt
#   SRC_REPO default /Users/tgartner/git/mylife_wiki (read only), WORK_DIR default $TMPDIR/karpathy-cap-spike, CAP_MB default 200
# Tries two guards against a full clone of a ~1.7 GB repo:
#   1. RLIMIT_FSIZE (`ulimit -f`): the packfile is ONE file, so capping the max file size caps the download.
#   2. A watchdog that polls `du` of the target dir and kills git when it passes the cap.
set -u
SRC=${1:-/Users/tgartner/git/mylife_wiki}
WORK=${2:-${TMPDIR:-/tmp}/karpathy-cap-spike}
CAP_MB=${3:-200}
now() { perl -MTime::HiRes=time -e 'printf "%.1f", time'; }
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK" || exit 1
echo "# spike 05 — $(date '+%Y-%m-%d %H:%M') — cap ${CAP_MB} MB — src $SRC"

echo; echo "## 1. ulimit -f (bash: 1024-byte blocks) around git clone --no-local"
a=$(now)
bash -c "ulimit -f $((CAP_MB * 1024)); exec git clone -q --no-local '$SRC' c1" 2>&1 | tail -3
echo "exit=${PIPESTATUS[0]}  after $(awk -v a="$a" -v b="$(now)" 'BEGIN{printf "%.1f", b-a}') s; left on disk: $(du -sm c1 2>/dev/null | awk '{print $1}') MB (git removes a failed clone dir: $( [ -d c1 ] && echo no || echo yes))"

echo; echo "## 2. du watchdog (poll every 0.5 s, SIGTERM git at the cap)"
a=$(now)
git clone -q --no-local "$SRC" c2 2>"$WORK/err2" & pid=$!
while kill -0 $pid 2>/dev/null; do
  used=$(du -sm c2 2>/dev/null | awk '{print $1}'); used=${used:-0}
  if [ "$used" -ge "$CAP_MB" ]; then kill -TERM $pid; echo "watchdog: killed git at ${used} MB"; break; fi
  sleep 0.5
done
wait $pid; rc=$?
echo "exit=$rc after $(awk -v a="$a" -v b="$(now)" 'BEGIN{printf "%.1f", b-a}') s; stderr: $(tail -c 200 "$WORK/err2" | tr '\n' ' ')"
echo "left on disk: $(du -sm c2 2>/dev/null | awk '{print $1}') MB (dir exists: $( [ -d c2 ] && echo yes || echo no))"

cd / && rm -rf "$WORK"; echo; echo "cleaned up $WORK"
