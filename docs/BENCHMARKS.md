# Benchmarks

`node scripts/bench.mjs` (after `make`) produces the table below. Each
batch-program figure is the median of 30 runs on a full 1,000-record batch,
including process start-up; Gatehouse is measured over HTTP on localhost.

Machine: Apple M4 Pro, 12 cores, 24 GiB, macOS 26.6, Node.js 24.17,
GnuCOBOL 3.2, gfortran 16.2.

| Benchmark | Median | p95 | Throughput |
|-----------|-------:|----:|-----------:|
| TXNGUARD — read 1,000 records from stdin, validate, tokenise, mask and seal them (COBOL + Fortran HMAC) | 67.7 ms | 70.6 ms | 14,774 records/s |
| TXNGUARD — same program built without `-debug` run-time checks | 66.3 ms | 69.7 ms | 15,092 records/s |
| FRAUDSCAN — score the accepted transfers (Fortran) | 14.6 ms | 15.2 ms | 67,692 records/s |
| LEDGERCK — verify a 1,000-entry ledger and the records it seals (COBOL + Fortran) | 18.2 ms | 19.5 ms | 55,068 entries/s |
| Gatehouse `POST /api/batch` — 1,000 transfers end to end | 122.0 ms | 135.6 ms | 8,194 transfers/s |
| SHA-256 of 64 MiB — Fortran kernel as shipped (`-O2 -fcheck=bounds,…`) | 368 ms | | 174 MiB/s |
| SHA-256 of 64 MiB — same Fortran, `-O3`, no run-time checks | 289 ms | | 221 MiB/s |
| SHA-256 of 64 MiB — OpenSSL (`openssl dgst -sha256`) | 37 ms | | 1,732 MiB/s |
| Watchtower — scan 99,251 lines of COBOL | 642.2 ms | 675.7 ms | 154,553 lines/s |
| Watchtower — scan 98,631 lines of Fortran | 137.5 ms | 180.6 ms | 717,562 lines/s |

The batch figures were stable to within 2 % over three runs. Reading the
batch from stdin one byte per `read(2)` call cost TXNGUARD 35 ms per 1,000
records; reading 4 KiB chunks into a buffer the kernel wipes line by line
costs nothing measurable and keeps the same guarantee (no stdio copy).

**A file-scanning agent stretches the tail, not the median.** Re-run later
with an endpoint-security agent scanning file writes in real time, the
medians came back within 3 %, but about 7 % of TXNGUARD runs — the only
program here that writes files — stalled for 0.2–2 s with unchanged CPU time
(0.05–0.07 s user), pushing p95 to several hundred milliseconds. In a Linux
container on the same machine, out of the agent's reach, 100 runs of the
same batch gave a 50.0 ms median and a 52.8 ms p95, with no outlier. If your
p95 is far above your median, look for such an agent before looking at the
code.

## What the numbers say

**Keep the run-time checks on.** GnuCOBOL's `-debug` (every subscript,
reference modification and numeric field checked) costs about **2 %** in
TXNGUARD; gfortran's `-fcheck=bounds,do,mem,pointer,recursion` costs about
**21 %** on raw SHA-256 throughput, the most check-heavy loop in the code
base. Both found or would have found real bugs (see
[HARDENING.md](HARDENING.md), item 5).

**The batch core is not the bottleneck.** A 1,000-transfer batch is
validated, pseudonymised, masked, scored, sealed and verified *twice* in
about an eighth of a second end to end; half of that is TXNGUARD, and much
of TXNGUARD's time is four HMACs per record (two account tokens, the record
MAC and the ledger MAC) plus process start-up.

**OpenSSL is ten times faster at bulk hashing** — it uses the ARMv8 SHA-256
instructions, while the Fortran kernel is portable integer code. That does
not matter for 247-byte ledger entries, but it is the reason the roadmap
lists a pluggable crypto backend behind the same `alz.h` ABI.

**Watchtower is fast enough to run on every keystroke**, which is what
Lookout does in the browser: about 150,000 lines of COBOL a second (its
symbol table and statement segmentation are the expensive part) and over
700,000 lines of Fortran.
