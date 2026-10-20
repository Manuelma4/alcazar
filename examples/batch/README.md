# Sample batch

`TXNIN.DAT` is a 16-record batch in the TXNGUARD input layout (fixed-length
200-byte records, see `docs/ARCHITECTURE.md`); `make demo` pipes it to
TXNGUARD's stdin one record per line, after the keys. Most
records carry one attack each: a sign flip, a 14-digit amount, fractional
cents, a forged IBAN check digit, an invalid card number, an unlisted
currency, 30 February, a replayed id, a self-transfer, a spreadsheet formula,
HTML in the memo and shell metacharacters in the id.

Run it with `make demo`.
