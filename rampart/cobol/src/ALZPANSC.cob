      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZPANSC.
      *----------------------------------------------------------------
      * ALZPANSC - look for a payment card number in free text, so a
      *            full PAN typed into a memo never leaves the core
      *            (PCI DSS: only BIN + last 4 may be displayed).
      *
      *   CALL "ALZPANSC" USING text rc position
      *
      *   text      PIC X ANY LENGTH
      *   rc        0 none found, 1 card number found
      *   position  1-based offset where it starts
      *
      * A card number here is a run of 13-19 digits - single spaces or
      * hyphens may separate them, as people write cards - that starts
      * with 2 to 6 (the ranges of the major card networks) and passes
      * the Luhn check. Shorter or longer runs (invoice numbers, IBAN
      * fragments) are left alone.
      *----------------------------------------------------------------
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-DIGIT IS "0123456789".
       DATA DIVISION.
       LOCAL-STORAGE SECTION.
       01  LS-LEN                      PIC S9(9) COMP-5.
       01  LS-I                        PIC S9(9) COMP-5.
       01  LS-START                    PIC S9(9) COMP-5.
       01  LS-COUNT                    PIC S9(9) COMP-5.
       01  LS-CH                       PIC X.
       01  LS-NEXT                     PIC X.
       01  LS-DIGITS                   PIC X(64).
       01  LS-LUHN-RC                  PIC S9(9) COMP-5.
       LINKAGE SECTION.
       01  LK-TEXT                     PIC X ANY LENGTH.
       01  LK-RC                       PIC S9(9) COMP-5.
       01  LK-POS                      PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-TEXT LK-RC LK-POS.
       0000-MAIN.
           MOVE 0 TO LK-RC
           MOVE 0 TO LK-POS
           MOVE FUNCTION LENGTH(LK-TEXT) TO LS-LEN
           MOVE 0 TO LS-COUNT
           PERFORM VARYING LS-I FROM 1 BY 1
                   UNTIL LS-I > LS-LEN OR LK-RC NOT = 0
               MOVE LK-TEXT(LS-I:1) TO LS-CH
               EVALUATE TRUE
                   WHEN LS-CH IS ALZ-DIGIT
                       PERFORM 1000-ADD-DIGIT
                   WHEN (LS-CH = SPACE OR "-") AND LS-COUNT > 0
                       PERFORM 2000-SEPARATOR
                   WHEN OTHER
                       PERFORM 3000-END-OF-RUN
               END-EVALUATE
           END-PERFORM
           IF LK-RC = 0
               PERFORM 3000-END-OF-RUN
           END-IF
           GOBACK.

       1000-ADD-DIGIT.
           IF LS-COUNT = 0
               MOVE LS-I TO LS-START
               MOVE SPACES TO LS-DIGITS
           END-IF
           IF LS-COUNT < 64
               ADD 1 TO LS-COUNT
               MOVE LS-CH TO LS-DIGITS(LS-COUNT:1)
           END-IF.

      * A separator continues the run only when a digit follows it.
       2000-SEPARATOR.
           MOVE SPACE TO LS-NEXT
           IF LS-I < LS-LEN
               MOVE LK-TEXT(LS-I + 1:1) TO LS-NEXT
           END-IF
           IF LS-NEXT IS NOT ALZ-DIGIT
               PERFORM 3000-END-OF-RUN
           END-IF.

       3000-END-OF-RUN.
           IF LS-COUNT >= 13 AND LS-COUNT <= 19
               IF LS-DIGITS(1:1) = "2" OR "3" OR "4" OR "5" OR "6"
                   CALL "ALZLUHN" USING LS-DIGITS LS-LUHN-RC
                   IF LS-LUHN-RC = 0
                       MOVE 1 TO LK-RC
                       MOVE LS-START TO LK-POS
                   END-IF
               END-IF
           END-IF
           MOVE 0 TO LS-COUNT.
       END PROGRAM ALZPANSC.
