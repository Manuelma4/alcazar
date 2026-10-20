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
      *   text      PIC X ANY LENGTH (the first 160 digits are read)
      *   rc        0 none found, 1 card number found
      *   position  1-based offset of its first digit
      *
      * People write card numbers in groups - "4111 1111 1111 1111",
      * "4111-1111-...", "4111.1111-..." - often next to an expiry
      * date or a CVV. So:
      *   1. Digit groups joined by one or two spaces, hyphens, dots
      *      or slashes form a chain.
      *   2. A chain glued to a capital letter is part of an
      *      identifier (an IBAN, a BBAN with letters, an RF creditor
      *      reference) and is skipped.
      *   3. Inside a chain only groups of 3 or more digits link up:
      *      dates, phone numbers and amounts, written in groups of
      *      two, never join a card number.
      *   4. Every stretch from a group start to a group end that has
      *      13-19 digits, starts with 2-6 (the major card networks)
      *      and passes the Luhn check is a card number.
      * Known limit: a card number glued to more digits with no
      * separator at all ("41111111111111111234") is one group, and
      * is not found.
      *----------------------------------------------------------------
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-DIGIT  IS "0123456789"
           CLASS ALZ-UPPER  IS "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
           CLASS ALZ-JOINER IS " -./".
       DATA DIVISION.
       LOCAL-STORAGE SECTION.
       01  LS-LEN                      PIC S9(9) COMP-5.
       01  LS-I                        PIC S9(9) COMP-5.
       01  LS-CH                       PIC X.
       01  LS-JOINER-LEN               PIC S9(9) COMP-5.
       01  LS-GAP-SW                   PIC X.
           88  LS-GAP                  VALUE "Y".
           88  LS-NO-GAP               VALUE "N".
       01  LS-FULL-SW                  PIC X VALUE "N".
           88  LS-FULL                 VALUE "Y".
       01  LS-DIGITS                   PIC X(160).
       01  LS-NDIG                     PIC S9(9) COMP-5.
       01  LS-NGROUP                   PIC S9(9) COMP-5.
      * One entry per digit group: where it is in the text and in
      * LS-DIGITS, how long it is, whether a joiner links it to the
      * group before, and whether it is glued to a capital letter.
       01  LS-GROUPS.
           05  LS-GROUP                OCCURS 80 TIMES.
               10  LS-G-POS            PIC S9(9) COMP-5.
               10  LS-G-START          PIC S9(9) COMP-5.
               10  LS-G-LEN            PIC S9(9) COMP-5.
               10  LS-G-JOINED         PIC X.
               10  LS-G-GLUED          PIC X.
       01  LS-A                        PIC S9(9) COMP-5.
       01  LS-Z                        PIC S9(9) COMP-5.
       01  LS-C                        PIC S9(9) COMP-5.
       01  LS-B                        PIC S9(9) COMP-5.
       01  LS-GI                       PIC S9(9) COMP-5.
       01  LS-GJ                       PIC S9(9) COMP-5.
       01  LS-WIN-START                PIC S9(9) COMP-5.
       01  LS-WIN-LEN                  PIC S9(9) COMP-5.
       01  LS-WINDOW                   PIC X(19).
       01  LS-LUHN-RC                  PIC S9(9) COMP-5.
       LINKAGE SECTION.
       01  LK-TEXT                     PIC X ANY LENGTH.
       01  LK-RC                       PIC S9(9) COMP-5.
       01  LK-POS                      PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-TEXT LK-RC LK-POS.
       0000-MAIN.
           MOVE 0 TO LK-RC
           MOVE 0 TO LK-POS
           PERFORM 1000-COLLECT-GROUPS
           PERFORM 2000-SCAN-CHAINS
           GOBACK.

      *----------------------------------------------------------------
      * Pass 1: the digit groups and the joiners between them.
      *----------------------------------------------------------------
       1000-COLLECT-GROUPS.
           MOVE FUNCTION LENGTH(LK-TEXT) TO LS-LEN
           MOVE 0 TO LS-NDIG
           MOVE 0 TO LS-NGROUP
           MOVE 0 TO LS-JOINER-LEN
           SET LS-GAP TO TRUE
           PERFORM VARYING LS-I FROM 1 BY 1
                   UNTIL LS-I > LS-LEN OR LS-FULL
               MOVE LK-TEXT(LS-I:1) TO LS-CH
               EVALUATE TRUE
                   WHEN LS-CH IS ALZ-DIGIT
                       PERFORM 1100-DIGIT
                   WHEN LS-CH IS ALZ-JOINER
                       ADD 1 TO LS-JOINER-LEN
                   WHEN OTHER
                       SET LS-GAP TO TRUE
                       MOVE 0 TO LS-JOINER-LEN
               END-EVALUATE
           END-PERFORM.

       1100-DIGIT.
           IF LS-NGROUP > 0 AND LS-NO-GAP AND LS-JOINER-LEN = 0
               ADD 1 TO LS-G-LEN(LS-NGROUP)
           ELSE
               PERFORM 1200-NEW-GROUP
           END-IF
           IF NOT LS-FULL
               ADD 1 TO LS-NDIG
               MOVE LS-CH TO LS-DIGITS(LS-NDIG:1)
               IF LS-NDIG = 160
                   SET LS-FULL TO TRUE
               END-IF
           END-IF
           SET LS-NO-GAP TO TRUE
           MOVE 0 TO LS-JOINER-LEN.

       1200-NEW-GROUP.
           IF LS-NGROUP = 80
               SET LS-FULL TO TRUE
           ELSE
               ADD 1 TO LS-NGROUP
               MOVE LS-I TO LS-G-POS(LS-NGROUP)
               COMPUTE LS-G-START(LS-NGROUP) = LS-NDIG + 1
               MOVE 1 TO LS-G-LEN(LS-NGROUP)
               MOVE "N" TO LS-G-JOINED(LS-NGROUP)
               MOVE "N" TO LS-G-GLUED(LS-NGROUP)
               IF LS-NGROUP > 1 AND LS-NO-GAP AND LS-JOINER-LEN <= 2
                   MOVE "Y" TO LS-G-JOINED(LS-NGROUP)
               ELSE
                   IF LS-I > 1
                       IF LK-TEXT(LS-I - 1:1) IS ALZ-UPPER
                           MOVE "Y" TO LS-G-GLUED(LS-NGROUP)
                       END-IF
                   END-IF
               END-IF
           END-IF.

      *----------------------------------------------------------------
      * Pass 2: chains (groups linked by joiners) A..Z; inside a chain
      * that is not glued to a capital letter, strict chains C..B of
      * groups of 3+ digits; inside those, the candidate windows.
      *----------------------------------------------------------------
       2000-SCAN-CHAINS.
           MOVE 1 TO LS-A
           PERFORM UNTIL LS-A > LS-NGROUP OR LK-RC NOT = 0
               MOVE LS-A TO LS-Z
               PERFORM UNTIL LS-Z = LS-NGROUP
                   IF LS-G-JOINED(LS-Z + 1) = "N"
                       EXIT PERFORM
                   END-IF
                   ADD 1 TO LS-Z
               END-PERFORM
               IF LS-G-GLUED(LS-A) = "N"
                   PERFORM 3000-STRICT-CHAINS
               END-IF
               COMPUTE LS-A = LS-Z + 1
           END-PERFORM.

       3000-STRICT-CHAINS.
           MOVE LS-A TO LS-C
           PERFORM UNTIL LS-C > LS-Z OR LK-RC NOT = 0
               MOVE LS-C TO LS-B
               PERFORM UNTIL LS-B = LS-Z
                   IF LS-G-LEN(LS-B) < 3 OR LS-G-LEN(LS-B + 1) < 3
                       EXIT PERFORM
                   END-IF
                   ADD 1 TO LS-B
               END-PERFORM
               PERFORM 4000-WINDOWS
               COMPUTE LS-C = LS-B + 1
           END-PERFORM.

       4000-WINDOWS.
           PERFORM VARYING LS-GI FROM LS-C BY 1
                   UNTIL LS-GI > LS-B OR LK-RC NOT = 0
               PERFORM VARYING LS-GJ FROM LS-GI BY 1
                       UNTIL LS-GJ > LS-B OR LK-RC NOT = 0
                   COMPUTE LS-WIN-LEN = LS-G-START(LS-GJ)
                       + LS-G-LEN(LS-GJ) - LS-G-START(LS-GI)
                   IF LS-WIN-LEN > 19
                       EXIT PERFORM
                   END-IF
                   IF LS-WIN-LEN >= 13
                       PERFORM 4100-CHECK-WINDOW
                   END-IF
               END-PERFORM
           END-PERFORM.

       4100-CHECK-WINDOW.
           MOVE LS-G-START(LS-GI) TO LS-WIN-START
           IF LS-DIGITS(LS-WIN-START:1) = "2" OR "3" OR "4" OR "5"
                                          OR "6"
               MOVE SPACES TO LS-WINDOW
               MOVE LS-DIGITS(LS-WIN-START:LS-WIN-LEN) TO LS-WINDOW
               CALL "ALZLUHN" USING LS-WINDOW LS-LUHN-RC
               IF LS-LUHN-RC = 0
                   MOVE 1 TO LK-RC
                   MOVE LS-G-POS(LS-GI) TO LK-POS
               END-IF
           END-IF.
       END PROGRAM ALZPANSC.
