# Benchmarks

`node scripts/bench.mjs` (after `make`) produces the table below. Each
batch-program figure is the median of 30 runs on a full 1,000-record batch,
including process start-up; Gatehouse is measured over HTTP on localhost.

Machine: Apple M4 Pro, 12 cores, 24 GiB, macOS 26.6, Node.js 24.17,
GnuCOBOL 3.2, gfortran 16.2.

| Benchmark | Median | p95 | Throughput |
|-----------|-------:|----:|-----------:|
| TXNGUARD — validate, tokenise, mask and seal 1,000 records (COBOL + Fortran HMAC) | 62.8 ms | 70.1 ms | 15,936 records/s |
| TXNGUARD — same program built without `-debug` run-time checks | 58.8 ms | 69.6 ms | 16,996 records/s |
| FRAUDSCAN — score the accepted transfers (Fortran) | 11.6 ms | 12.3 ms | 85,371 records/s |
| LEDGERCK — verify a 1,000-entry HMAC chain (COBOL + Fortran) | 15.8 ms | 18.3 ms | 63,167 entries/s |
| Gatehouse `POST /api/batch` — 1,000 transfers end to end | 108.5 ms | 119.6 ms | 9,218 transfers/s |
| SHA-256 of 64 MiB — Fortran kernel as shipped (`-O2 -fcheck=bounds,…`) | 370 ms | | 173 MiB/s |
| SHA-256 of 64 MiB — same Fortran, `-O3`, no run-time checks | 294 ms | | 218 MiB/s |
| SHA-256 of 64 MiB — OpenSSL (`openssl dgst -sha256`) | 36 ms | | 1,756 MiB/s |
| Watchtower — scan 99,251 lines of COBOL | 647.9 ms | 690.1 ms | 153,198 lines/s |
| Watchtower — scan 98,631 lines of Fortran | 135.7 ms | 185.2 ms | 726,776 lines/s |

## What the numbers say

**Keep the run-time checks on.** GnuCOBOL's `-debug` (every subscript,
reference modification and numeric field checked) costs about **6 %** in
TXNGUARD; gfortran's `-fcheck=bounds,do,mem,pointer,recursion` costs about
**21 %** on raw SHA-256 throughput, the most check-heavy loop in the code
base. Both found or would have found real bugs (see
[HARDENING.md](HARDENING.md), item 5).

**The batch core is not the bottleneck.** A 1,000-transfer batch is
validated, pseudonymised, masked, scored, sealed and verified *twice* in
about a tenth of a second end to end; a quarter of that is TXNGUARD, and much
of TXNGUARD's time is three HMACs per record (two account tokens and the
ledger MAC) plus process start-up.

**OpenSSL is ten times faster at bulk hashing** — it uses the ARMv8 SHA-256
instructions, while the Fortran kernel is portable integer code. That does
not matter for 247-byte ledger entries, but it is the reason the roadmap
lists a pluggable crypto backend behind the same `alz.h` ABI.

**Watchtower is fast enough to run on every keystroke**, which is what
Lookout does in the browser: about 150,000 lines of COBOL a second (its
symbol table and statement segmentation are the expensive part) and over
700,000 lines of Fortran.
