      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZAMNT.
      *----------------------------------------------------------------
      * ALZAMNT - strict parser for decimal amounts.
      *
      * FUNCTION NUMVAL is deliberately not used: it accepts many
      * formats and yields 0 for bad input, which silently turns
      * garbage into money.
      *
      *   CALL "ALZAMNT" USING text sign cents rc position
      *
      *   text      PIC X ANY LENGTH:
      *             [+|-] 1-13 digits [ . 1-2 digits ] then spaces
      *   sign      PIC X           "+" or "-"
      *   cents     PIC 9(15) COMP-3, the magnitude in minor units.
      *             The sign is returned separately and is never
      *             folded into a field that could silently drop it.
      *   rc        0 ok, 1 grammar, 2 more than 13 integer digits
      *   position  1-based offset of the first offending character
      *----------------------------------------------------------------
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-DIGIT IS "0123456789".
       DATA DIVISION.
       LOCAL-STORAGE SECTION.
       01  LS-LEN                      PIC S9(9) COMP-5.
       01  LS-I                        PIC S9(9) COMP-5.
       01  LS-CH                       PIC X.
       01  LS-DIGIT-X                  PIC X.
       01  LS-DIGIT REDEFINES LS-DIGIT-X PIC 9.
       01  LS-INTEGER                  PIC 9(13) COMP-3 VALUE 0.
       01  LS-DECIMALS                 PIC 99 VALUE 0.
       01  LS-DEC-COUNT                PIC 9 VALUE 0.
       01  LS-STATE                    PIC X VALUE "S".
           88  ST-START                VALUE "S".
           88  ST-SIGNED               VALUE "G".
           88  ST-INTEGER              VALUE "I".
           88  ST-POINT                VALUE "P".
           88  ST-DECIMALS             VALUE "D".
           88  ST-TRAILING             VALUE "T".
           88  ST-ERROR                VALUE "E".
       LINKAGE SECTION.
       01  LK-TEXT                     PIC X ANY LENGTH.
       01  LK-SIGN                     PIC X.
       01  LK-CENTS                    PIC 9(15) COMP-3.
       01  LK-RC                       PIC S9(9) COMP-5.
       01  LK-POS                      PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-TEXT LK-SIGN LK-CENTS LK-RC
                                LK-POS.
       0000-MAIN.
           MOVE "+" TO LK-SIGN
           MOVE 0 TO LK-CENTS
           MOVE 0 TO LK-RC
           MOVE 0 TO LK-POS
           MOVE FUNCTION LENGTH(LK-TEXT) TO LS-LEN
           PERFORM VARYING LS-I FROM 1 BY 1
                   UNTIL LS-I > LS-LEN OR ST-ERROR
               MOVE LK-TEXT(LS-I:1) TO LS-CH
               PERFORM 1000-NEXT-CHARACTER
           END-PERFORM
           IF LK-RC = 0
               IF ST-INTEGER OR ST-DECIMALS OR ST-TRAILING
                   IF LS-DEC-COUNT = 1
                       MULTIPLY 10 BY LS-DECIMALS
                   END-IF
                   COMPUTE LK-CENTS = LS-INTEGER * 100 + LS-DECIMALS
               ELSE
                   MOVE 1 TO LK-RC
                   MOVE LS-I TO LK-POS
               END-IF
           END-IF
           IF LK-RC NOT = 0
               MOVE 0 TO LK-CENTS
           END-IF
           GOBACK.

       1000-NEXT-CHARACTER.
           EVALUATE TRUE
               WHEN LS-CH = SPACE
                   EVALUATE TRUE
                       WHEN ST-INTEGER OR ST-DECIMALS OR ST-TRAILING
                           SET ST-TRAILING TO TRUE
                       WHEN OTHER
                           PERFORM 9000-GRAMMAR-ERROR
                   END-EVALUATE
               WHEN LS-CH = "+" OR "-"
                   IF ST-START
                       MOVE LS-CH TO LK-SIGN
                       SET ST-SIGNED TO TRUE
                   ELSE
                       PERFORM 9000-GRAMMAR-ERROR
                   END-IF
               WHEN LS-CH = "."
                   IF ST-INTEGER
                       SET ST-POINT TO TRUE
                   ELSE
                       PERFORM 9000-GRAMMAR-ERROR
                   END-IF
               WHEN LS-CH IS ALZ-DIGIT
                   MOVE LS-CH TO LS-DIGIT-X
                   PERFORM 2000-DIGIT
               WHEN OTHER
                   PERFORM 9000-GRAMMAR-ERROR
           END-EVALUATE.

       2000-DIGIT.
           EVALUATE TRUE
               WHEN ST-START OR ST-SIGNED OR ST-INTEGER
                   COMPUTE LS-INTEGER = LS-INTEGER * 10 + LS-DIGIT
                       ON SIZE ERROR
                           MOVE 2 TO LK-RC
                           MOVE LS-I TO LK-POS
                           SET ST-ERROR TO TRUE
                       NOT ON SIZE ERROR
                           SET ST-INTEGER TO TRUE
                   END-COMPUTE
               WHEN (ST-POINT OR ST-DECIMALS) AND LS-DEC-COUNT < 2
                   COMPUTE LS-DECIMALS = LS-DECIMALS * 10 + LS-DIGIT
                   ADD 1 TO LS-DEC-COUNT
                   SET ST-DECIMALS TO TRUE
               WHEN OTHER
                   PERFORM 9000-GRAMMAR-ERROR
           END-EVALUATE.

       9000-GRAMMAR-ERROR.
           MOVE 1 TO LK-RC
           MOVE LS-I TO LK-POS
           SET ST-ERROR TO TRUE.
       END PROGRAM ALZAMNT.
