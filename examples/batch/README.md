# Sample batch

`TXNIN.DAT` is a 16-record batch in the TXNGUARD input layout (fixed-length
200-byte records, see [the architecture guide](../../docs/ARCHITECTURE.md)); `make demo` pipes it to
TXNGUARD's stdin one record per line, after the keys. Most
records carry one attack each: a sign flip, a 14-digit amount, fractional
cents, a forged IBAN check digit, an invalid card number, an unlisted
currency, 30 February, a replayed id, a self-transfer, a spreadsheet formula,
HTML in the memo and shell metacharacters in the id.

## Run the local demo

From the repository root, with GnuCOBOL and gfortran available, run:

```sh
make -j2 demo
```

The target builds the batch programs and recreates the ignored `var/demo/`
directory. Keep any previous demo artifacts you need in a different directory
before rerunning it. Use the bundled fixture and the fresh demonstration keys.

Expect TXNGUARD to report four accepted records and twelve rejections. The
printed return code 4 belongs to TXNGUARD and is expected for this mixed batch.
The script first shows a successful ledger check, then the expected rejection
of a deliberately modified demonstration ledger. The retained `LEDGER.DAT`
is that rejection fixture. The final auditor step uses Node.js when available,
and `RISK.JSON` records the risk pass on the accepted transfers. Keep these
outputs and `K_LEDGER.key` local.
