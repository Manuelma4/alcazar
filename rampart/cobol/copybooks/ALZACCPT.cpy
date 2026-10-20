      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZACCPT - accepted transfer, normalised and pseudonymised
      *            (206 bytes). Accounts appear only as HMAC tokens
      *            and masked IBANs; card numbers only masked.
      *----------------------------------------------------------------
       01  TXN-OK-REC.
           05  TA-ID                   PIC X(12).
           05  TA-TS                   PIC X(14).
           05  TA-FROM-TOKEN           PIC X(16).
           05  TA-TO-TOKEN             PIC X(16).
           05  TA-FROM-MASKED          PIC X(34).
           05  TA-TO-MASKED            PIC X(34).
           05  TA-AMOUNT-CENTS         PIC 9(15).
           05  TA-CURRENCY             PIC X(3).
           05  TA-CHANNEL              PIC X(3).
           05  TA-PAN-MASKED           PIC X(19).
           05  TA-MEMO                 PIC X(40).
