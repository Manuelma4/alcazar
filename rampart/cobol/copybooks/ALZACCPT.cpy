      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZACCPT - accepted transfer, normalised and pseudonymised:
      *            206 bytes of data and a line feed, written as a
      *            fixed-length 207-byte record (nothing is trimmed,
      *            so the bytes on disk are exactly the bytes sealed
      *            by the ledger). Accounts appear only as HMAC tokens
      *            and masked IBANs; card numbers only masked.
      *----------------------------------------------------------------
       01  TXN-OK-REC.
           05  TA-DATA.
               10  TA-ID               PIC X(12).
               10  TA-TS               PIC X(14).
               10  TA-FROM-TOKEN       PIC X(16).
               10  TA-TO-TOKEN         PIC X(16).
               10  TA-FROM-MASKED      PIC X(34).
               10  TA-TO-MASKED        PIC X(34).
               10  TA-AMOUNT-CENTS     PIC 9(15).
               10  TA-CURRENCY         PIC X(3).
               10  TA-CHANNEL          PIC X(3).
               10  TA-PAN-MASKED       PIC X(19).
               10  TA-MEMO             PIC X(40).
           05  TA-EOL                  PIC X.
