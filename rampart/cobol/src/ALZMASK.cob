      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZMASK.
      *----------------------------------------------------------------
      * ALZMASK - mask an account or card number for display and
      *           storage, keeping its length.
      *
      *   CALL "ALZMASK" USING mode input output
      *
      *   mode    PIC X   P  card: BIN (first 6) + last 4, the most
      *                      PCI DSS allows; last 4 only when shorter
      *                      than 15 digits
      *                   L  card: last 4 only
      *                   I  IBAN: country, check digits and last 4
      *                   any other value masks everything
      *   input   PIC X ANY LENGTH, left-justified
      *   output  PIC X ANY LENGTH, receives the masked value
      *----------------------------------------------------------------
       DATA DIVISION.
       LOCAL-STORAGE SECTION.
       01  LS-LEN                      PIC S9(9) COMP-5.
       01  LS-OUT-LEN                  PIC S9(9) COMP-5.
       01  LS-HEAD                     PIC S9(9) COMP-5.
       01  LS-I                        PIC S9(9) COMP-5.
       LINKAGE SECTION.
       01  LK-MODE                     PIC X.
       01  LK-INPUT                    PIC X ANY LENGTH.
       01  LK-OUTPUT                   PIC X ANY LENGTH.

       PROCEDURE DIVISION USING LK-MODE LK-INPUT LK-OUTPUT.
       0000-MAIN.
           MOVE SPACES TO LK-OUTPUT
           MOVE FUNCTION LENGTH(LK-OUTPUT) TO LS-OUT-LEN
           MOVE FUNCTION LENGTH(LK-INPUT) TO LS-LEN
           PERFORM UNTIL LS-LEN = 0
               IF LK-INPUT(LS-LEN:1) NOT = SPACE
                   EXIT PERFORM
               END-IF
               SUBTRACT 1 FROM LS-LEN
           END-PERFORM

           EVALUATE TRUE
               WHEN LK-MODE = "P" AND LS-LEN >= 15
                   MOVE 6 TO LS-HEAD
               WHEN LK-MODE = "I"
                   MOVE 4 TO LS-HEAD
               WHEN OTHER
                   MOVE 0 TO LS-HEAD
           END-EVALUATE

           PERFORM VARYING LS-I FROM 1 BY 1
                   UNTIL LS-I > LS-LEN OR LS-I > LS-OUT-LEN
               IF LS-I <= LS-HEAD
                  OR (LS-I > LS-LEN - 4 AND
                      (LK-MODE = "P" OR "L" OR "I"))
                   MOVE LK-INPUT(LS-I:1) TO LK-OUTPUT(LS-I:1)
               ELSE
                   MOVE "*" TO LK-OUTPUT(LS-I:1)
               END-IF
           END-PERFORM
           GOBACK.
       END PROGRAM ALZMASK.
