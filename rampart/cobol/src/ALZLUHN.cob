      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZLUHN.
      *----------------------------------------------------------------
      * ALZLUHN - validate a payment card number (ISO/IEC 7812):
      *           12 to 19 digits and a valid Luhn check digit.
      *
      *   CALL "ALZLUHN" USING pan rc
      *
      *   pan  PIC X ANY LENGTH, left-justified
      *   rc   0 valid, 1 not 12-19 digits, 2 Luhn check failed
      *----------------------------------------------------------------
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-DIGIT IS "0123456789".
       DATA DIVISION.
       LOCAL-STORAGE SECTION.
       01  LS-LEN                      PIC S9(9) COMP-5.
       01  LS-I                        PIC S9(9) COMP-5.
       01  LS-SUM                      PIC 9(4) COMP-5.
       01  LS-VALUE                    PIC 99.
       01  LS-DOUBLE                   PIC X.
           88  LS-DOUBLE-IT            VALUE "Y".
           88  LS-KEEP-IT              VALUE "N".
       01  LS-DIGIT-X                  PIC X.
       01  LS-DIGIT REDEFINES LS-DIGIT-X PIC 9.
       LINKAGE SECTION.
       01  LK-PAN                      PIC X ANY LENGTH.
       01  LK-RC                       PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-PAN LK-RC.
       0000-MAIN.
           MOVE 0 TO LK-RC
           MOVE FUNCTION LENGTH(LK-PAN) TO LS-LEN
           PERFORM UNTIL LS-LEN = 0
               IF LK-PAN(LS-LEN:1) NOT = SPACE
                   EXIT PERFORM
               END-IF
               SUBTRACT 1 FROM LS-LEN
           END-PERFORM
           IF LS-LEN < 12 OR LS-LEN > 19
               MOVE 1 TO LK-RC
               GOBACK
           END-IF
           IF LK-PAN(1:LS-LEN) IS NOT ALZ-DIGIT
               MOVE 1 TO LK-RC
               GOBACK
           END-IF

      *    From the right: every second digit is doubled, and 9 is
      *    subtracted when the double exceeds 9.
           MOVE 0 TO LS-SUM
           SET LS-KEEP-IT TO TRUE
           PERFORM VARYING LS-I FROM LS-LEN BY -1 UNTIL LS-I < 1
               MOVE LK-PAN(LS-I:1) TO LS-DIGIT-X
               MOVE LS-DIGIT TO LS-VALUE
               IF LS-DOUBLE-IT
                   COMPUTE LS-VALUE = LS-VALUE * 2
                   IF LS-VALUE > 9
                       SUBTRACT 9 FROM LS-VALUE
                   END-IF
                   SET LS-KEEP-IT TO TRUE
               ELSE
                   SET LS-DOUBLE-IT TO TRUE
               END-IF
               ADD LS-VALUE TO LS-SUM
           END-PERFORM
           IF FUNCTION MOD(LS-SUM, 10) NOT = 0
               MOVE 2 TO LK-RC
           END-IF
           GOBACK.
       END PROGRAM ALZLUHN.
