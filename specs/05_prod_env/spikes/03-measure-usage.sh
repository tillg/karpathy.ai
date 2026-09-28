#!/usr/bin/env bash
# Spike 03: cost of measuring disk usage on the server (du, df, git count-objects, Node fs.statfs).
#
# Run (dev stack up):  bash specs/05_prod_env/spikes/03-measure-usage.sh [container] [vault-id] 2>&1 | tee specs/05_prod_env/spikes/03-measure-usage.out.txt
#   container default karpathy-app-backend-1, vault-id default my-life-wiki (the ~5.6k-file demo vault)
# Read-only: only runs du/df/git count-objects/node inside the backend container.
set -u
C=${1:-karpathy-app-backend-1}
V=${2:-my-life-wiki}
echo "# spike 03 — $(date '+%Y-%m-%d %H:%M') — container $C, vault /vaults/$V"
docker exec -i "$C" sh -s "$V" <<'EOF'
V=$1
# busybox date has no %N: time the command from node (spawn only, node startup not counted).
t() { node -e 'const t=process.hrtime.bigint();try{require("child_process").execFileSync(process.argv[1],process.argv.slice(2),{stdio:"inherit"})}catch(e){};console.log("   -> "+(Number(process.hrtime.bigint()-t)/1e6).toFixed(1)+" ms")' "$@"; }
echo "files in working tree (excl .git): $(find /vaults/$V -path /vaults/$V/.git -prune -o -type f -print | wc -l)"
echo "files in .git: $(find /vaults/$V/.git -type f | wc -l)"
echo; echo "## df (whole volume = the VM/host filesystem here)"; t df -k /vaults
echo; echo "## du -sk one vault (page cache warm: the vault was just used; no privilege to drop caches)"; t du -sk /vaults/$V
echo "## du -sk one vault (warm, second run)"; t du -sk /vaults/$V
echo "## du -sb (apparent bytes) — busybox du may not support -b:"; t du -sb /vaults/$V 2>&1 | head -2
echo "## du -sk all vaults"; t du -sk /vaults
echo "## du -sk .git only"; t du -sk /vaults/$V/.git
echo; echo "## git count-objects -vH"; t git -C /vaults/$V count-objects -vH
echo; echo "## node fs.statfs (what a /health endpoint would call)"
node -e '
const fs=require("node:fs");const t=process.hrtime.bigint();const s=fs.statfsSync("/vaults");
const ms=Number(process.hrtime.bigint()-t)/1e6;
console.log(JSON.stringify({totalBytes:s.blocks*s.bsize,freeBytes:s.bavail*s.bsize,ms:+ms.toFixed(3)}));'
echo; echo "## node recursive size walk (fs.promises.readdir withFileTypes + lstat)"
node -e '
const {readdir,lstat}=require("node:fs/promises");const {join}=require("node:path");
async function walk(d){let n=0,b=0;for(const e of await readdir(d,{withFileTypes:true})){const p=join(d,e.name);
if(e.isDirectory()){const r=await walk(p);n+=r.n;b+=r.b}else{const s=await lstat(p);n++;b+=s.blocks*512}}return{n,b}}
(async()=>{const t=Date.now();const r=await walk("/vaults/'"$V"'");console.log(JSON.stringify({files:r.n,MB:+(r.b/1048576).toFixed(0),ms:Date.now()-t}))})();'
EOF
