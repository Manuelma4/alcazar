      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZLEDG - one entry of the HMAC-chained audit ledger (Seal),
      *           246 bytes, "|"-separated fixed-width fields.
      *
      *   LG-MAC = HMAC-SHA256(K-ledger, LG-MAC-INPUT)
      *
      * LG-MAC-INPUT is the first 181 bytes and includes LG-PREV-MAC,
      * so every entry seals the whole chain before it.
      *----------------------------------------------------------------
       01  LEDGER-LINE.
           05  LG-MAC-INPUT.
               10  LG-SEQ              PIC 9(6).
               10  LG-SEP-1            PIC X VALUE "|".
               10  LG-TYPE             PIC X.
                   88  LG-ACCEPTED     VALUE "A".
                   88  LG-REJECTED     VALUE "R".
               10  LG-SEP-2            PIC X VALUE "|".
               10  LG-ID               PIC X(12).
               10  LG-SEP-3            PIC X VALUE "|".
               10  LG-TS               PIC X(14).
               10  LG-SEP-4            PIC X VALUE "|".
               10  LG-CODE             PIC X(4).
               10  LG-SEP-5            PIC X VALUE "|".
               10  LG-AMOUNT-CENTS     PIC 9(15).
               10  LG-SEP-6            PIC X VALUE "|".
               10  LG-CURRENCY         PIC X(3).
               10  LG-SEP-7            PIC X VALUE "|".
               10  LG-FROM-MASKED      PIC X(34).
               10  LG-SEP-8            PIC X VALUE "|".
               10  LG-PAN-LAST4        PIC X(19).
               10  LG-SEP-9            PIC X VALUE "|".
               10  LG-PREV-MAC         PIC X(64).
           05  LG-SEP-10               PIC X VALUE "|".
           05  LG-MAC                  PIC X(64).
