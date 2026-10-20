#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Command-line demo of the batch core: validate and seal a sample batch,
# verify the ledger, tamper with it, verify again, and score the accepted
# transfers. Run with `make demo`.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
bin="$root/build/bin"
dir="$root/var/demo"
rm -rf "$dir"
mkdir -p "$dir"
chmod 700 "$dir"
cp "$root/examples/batch/TXNIN.DAT" "$dir/"
cd "$dir"

# A fresh 256-bit master key. Like Gatehouse, the demo derives one sub-key
# per purpose, K = HMAC-SHA256(master, label || 0x01), and gives each
# program only the ones it needs, on stdin.
master=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
derive() {
  label=$(printf '%s\001' "$1" | od -An -tx1 | tr -d ' \n')
  printf 'H %s %s\n' "$master" "$label" | "$bin/alzhmac"
}
k_ledger=$(derive alcazar/ledger/v1)
k_token=$(derive alcazar/token/v1)
master=
job=demo-$(date +%s)
run() { env -i PATH=/usr/bin:/bin "$@"; }

echo "== TXNGUARD (COBOL) =========================================="
rc=0
printf '%s\n%s\n' "$k_ledger" "$k_token" | run "$bin/txnguard" "$job" || rc=$?
echo "return code $rc (0 all accepted, 4 some rejected)"
sed -n 's/^/  /p' SUMMARY.DAT
echo
echo "Rejected records:"
sed -n 's/^/  /p' REJECTED.DAT
rm -f TXNIN.DAT

echo
echo "== LEDGERCK (COBOL + Fortran HMAC) ==========================="
printf '%s\n' "$k_ledger" | run "$bin/ledgerck" "$job" || true
echo
echo "Tampering with the amount of entry 2..."
awk 'NR == 2 { $0 = substr($0, 1, 43) "000000099999999" substr($0, 59) } { print }' \
  LEDGER.DAT > LEDGER.TMP && mv LEDGER.TMP LEDGER.DAT
printf '%s\n' "$k_ledger" | run "$bin/ledgerck" "$job" || true

echo
echo "== FRAUDSCAN (Fortran) ======================================="
run "$bin/fraudscan" ACCEPTED.DAT RISK.JSON
echo "risk report written to var/demo/RISK.JSON"
