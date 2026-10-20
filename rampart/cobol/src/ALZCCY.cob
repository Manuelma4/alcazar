      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZCCY.
      *----------------------------------------------------------------
      * ALZCCY - check a currency against an explicit allowlist of
      *          ISO 4217 codes with two minor units.
      *
      *   CALL "ALZCCY" USING currency rc
      *
      *   currency  PIC X(3)
      *   rc        0 allowed, 1 not allowed
      *----------------------------------------------------------------
       DATA DIVISION.
       LINKAGE SECTION.
       01  LK-CURRENCY                 PIC X(3).
      *    No BGN: Bulgaria adopted the euro on 1 January 2026.
           88  LK-CURRENCY-ALLOWED     VALUE "EUR" "USD" "GBP" "CHF"
                                             "SEK" "NOK" "DKK" "PLN"
                                             "CZK" "HUF" "RON" "CAD"
                                             "AUD" "NZD".
       01  LK-RC                       PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-CURRENCY LK-RC.
       0000-MAIN.
           IF LK-CURRENCY-ALLOWED
               MOVE 0 TO LK-RC
           ELSE
               MOVE 1 TO LK-RC
           END-IF
           GOBACK.
       END PROGRAM ALZCCY.
