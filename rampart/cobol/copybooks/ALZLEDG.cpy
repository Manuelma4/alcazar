      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZLEDG - one entry of the HMAC-chained audit ledger (Seal),
      *           format v2: 312 bytes of "|"-separated fixed-width
      *           fields and a line feed, written and read as a
      *           fixed-length 313-byte record.
      *
      *   LG-RECORD-MAC = HMAC-SHA256(K-ledger, "alcazar/record|" ||
      *                   the ACCEPTED or REJECTED record)
      *   LG-MAC        = HMAC-SHA256(K-ledger, LG-MAC-INPUT)
      *
      * LG-TEXT is everything before the line feed. LG-MAC-INPUT is
      * its first 247 bytes and includes LG-PREV-MAC, so every entry
      * seals the whole chain before it, and LG-RECORD-MAC, so it
      * seals the full decision record too.
      * LG-SIGN is "+" or "-", or "?" when the amount did not parse.
      *----------------------------------------------------------------
       01  LEDGER-LINE.
           05  LG-TEXT.
               10  LG-MAC-INPUT.
                   15  LG-SEQ          PIC 9(6).
                   15  LG-SEP-1        PIC X VALUE "|".
                   15  LG-TYPE         PIC X.
                       88  LG-ACCEPTED VALUE "A".
                       88  LG-REJECTED VALUE "R".
                   15  LG-SEP-2        PIC X VALUE "|".
                   15  LG-ID           PIC X(12).
                   15  LG-SEP-3        PIC X VALUE "|".
                   15  LG-TS           PIC X(14).
                   15  LG-SEP-4        PIC X VALUE "|".
                   15  LG-CODE         PIC X(4).
                   15  LG-SEP-5        PIC X VALUE "|".
                   15  LG-SIGN         PIC X.
                       88  LG-SIGN-VALID
                                       VALUE "+" "-" "?".
                   15  LG-AMOUNT-CENTS PIC 9(15).
                   15  LG-SEP-6        PIC X VALUE "|".
                   15  LG-CURRENCY     PIC X(3).
                   15  LG-SEP-7        PIC X VALUE "|".
                   15  LG-FROM-MASKED  PIC X(34).
                   15  LG-SEP-8        PIC X VALUE "|".
                   15  LG-PAN-LAST4    PIC X(19).
                   15  LG-SEP-9        PIC X VALUE "|".
                   15  LG-RECORD-MAC   PIC X(64).
                   15  LG-SEP-10       PIC X VALUE "|".
                   15  LG-PREV-MAC     PIC X(64).
               10  LG-SEP-11           PIC X VALUE "|".
               10  LG-MAC              PIC X(64).
           05  LG-EOL                  PIC X VALUE X"0A".
