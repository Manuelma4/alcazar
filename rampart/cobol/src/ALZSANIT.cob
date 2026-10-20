      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZSANIT.
      *----------------------------------------------------------------
      * ALZSANIT - replace, in place, every character outside a policy
      *            class with "?" (spaces are kept), so untrusted text
      *            can be written to reports and the ledger safely.
      *
      *   CALL "ALZSANIT" USING policy text
      *
      *   policy  PIC X   I N D A H S P, as in ALZTEXT. An unknown
      *                   policy replaces every non-space (fail safe).
      *   text    PIC X ANY LENGTH, updated in place
      *----------------------------------------------------------------
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-IDENT IS "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                              "0123456789" "-"
           CLASS ALZ-ALNUM IS "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                              "0123456789"
           CLASS ALZ-DIGIT IS "0123456789"
           CLASS ALZ-UPPER IS "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
           CLASS ALZ-HEX   IS "0123456789abcdef"
           CLASS ALZ-SEPA  IS "abcdefghijklmnopqrstuvwxyz"
                              "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                              "0123456789" "/-?:().,'+ "
           CLASS ALZ-PRINT IS X"20" THRU X"7E".
       DATA DIVISION.
       LOCAL-STORAGE SECTION.
       01  LS-I                        PIC S9(9) COMP-5.
       01  LS-CH                       PIC X.
       01  LS-VERDICT                  PIC X.
           88  LS-CHAR-OK              VALUE "Y".
           88  LS-CHAR-BAD             VALUE "N".
       LINKAGE SECTION.
       01  LK-POLICY                   PIC X.
       01  LK-TEXT                     PIC X ANY LENGTH.

       PROCEDURE DIVISION USING LK-POLICY LK-TEXT.
       0000-MAIN.
           PERFORM VARYING LS-I FROM 1 BY 1
                   UNTIL LS-I > FUNCTION LENGTH(LK-TEXT)
               MOVE LK-TEXT(LS-I:1) TO LS-CH
               IF LS-CH NOT = SPACE
                   PERFORM 1000-CHECK-CHAR
                   IF LS-CHAR-BAD
                       MOVE "?" TO LK-TEXT(LS-I:1)
                   END-IF
               END-IF
           END-PERFORM
           GOBACK.

       1000-CHECK-CHAR.
           SET LS-CHAR-BAD TO TRUE
           EVALUATE TRUE
               WHEN LK-POLICY = "I" AND LS-CH IS ALZ-IDENT
               WHEN LK-POLICY = "N" AND LS-CH IS ALZ-ALNUM
               WHEN LK-POLICY = "D" AND LS-CH IS ALZ-DIGIT
               WHEN LK-POLICY = "A" AND LS-CH IS ALZ-UPPER
               WHEN LK-POLICY = "H" AND LS-CH IS ALZ-HEX
               WHEN LK-POLICY = "S" AND LS-CH IS ALZ-SEPA
               WHEN LK-POLICY = "P" AND LS-CH IS ALZ-PRINT
                   SET LS-CHAR-OK TO TRUE
           END-EVALUATE.
       END PROGRAM ALZSANIT.
