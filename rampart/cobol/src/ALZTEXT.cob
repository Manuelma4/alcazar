      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZTEXT.
      *----------------------------------------------------------------
      * ALZTEXT - check a left-justified text field against a
      *           character policy.
      *
      *   CALL "ALZTEXT" USING policy text rc position
      *
      *   policy    PIC X   I  identifier   A-Z 0-9 -
      *                     N  upper alnum  A-Z 0-9
      *                     D  digits       0-9
      *                     A  letters      A-Z
      *                     H  hex          0-9 a-f
      *                     S  SEPA text    a-z A-Z 0-9 / - ? : ( )
      *                                     . , ' + and space
      *                     P  printable    X"20" to X"7E"
      *                     F  formula      no leading = + - @ TAB CR
      *   text      PIC X ANY LENGTH. The value ends at the last
      *             non-space; only S and P allow inner spaces.
      *   rc        0 ok, 1 bad character, 2 formula prefix,
      *             3 empty, 9 unknown policy
      *   position  1-based offset of the offending character
      *
      * Classes list every member explicitly, so they hold under any
      * collating sequence (A-Z is not contiguous in EBCDIC).
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
       01  LS-LAST                     PIC S9(9) COMP-5.
       01  LS-FIRST                    PIC S9(9) COMP-5.
       01  LS-I                        PIC S9(9) COMP-5.
       01  LS-CH                       PIC X.
       01  LS-VERDICT                  PIC X.
           88  LS-CHAR-OK              VALUE "Y".
           88  LS-CHAR-BAD             VALUE "N".
       LINKAGE SECTION.
       01  LK-POLICY                   PIC X.
       01  LK-TEXT                     PIC X ANY LENGTH.
       01  LK-RC                       PIC S9(9) COMP-5.
       01  LK-POS                      PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-POLICY LK-TEXT LK-RC LK-POS.
       0000-MAIN.
           MOVE 0 TO LK-RC
           MOVE 0 TO LK-POS
           PERFORM 1000-FIND-LAST
           IF LS-LAST = 0
               MOVE 3 TO LK-RC
               GOBACK
           END-IF
           EVALUATE LK-POLICY
               WHEN "F"
                   PERFORM 3000-CHECK-FORMULA
               WHEN "I"
               WHEN "N"
               WHEN "D"
               WHEN "A"
               WHEN "H"
               WHEN "S"
               WHEN "P"
                   PERFORM 2000-CHECK-CHARSET
               WHEN OTHER
                   MOVE 9 TO LK-RC
           END-EVALUATE
           GOBACK.

       1000-FIND-LAST.
           MOVE FUNCTION LENGTH(LK-TEXT) TO LS-LAST
           PERFORM UNTIL LS-LAST = 0
               IF LK-TEXT(LS-LAST:1) NOT = SPACE
                   EXIT PERFORM
               END-IF
               SUBTRACT 1 FROM LS-LAST
           END-PERFORM.

       2000-CHECK-CHARSET.
           PERFORM VARYING LS-I FROM 1 BY 1 UNTIL LS-I > LS-LAST
               MOVE LK-TEXT(LS-I:1) TO LS-CH
               PERFORM 2100-CHECK-CHAR
               IF LS-CHAR-BAD
                   MOVE 1 TO LK-RC
                   MOVE LS-I TO LK-POS
                   EXIT PERFORM
               END-IF
           END-PERFORM.

       2100-CHECK-CHAR.
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

      * A cell that starts with = + - @ (or TAB/CR) is evaluated as a
      * formula when an export is opened in a spreadsheet (CWE-1236).
       3000-CHECK-FORMULA.
           MOVE 0 TO LS-FIRST
           PERFORM VARYING LS-I FROM 1 BY 1 UNTIL LS-I > LS-LAST
               IF LK-TEXT(LS-I:1) NOT = SPACE
                   MOVE LS-I TO LS-FIRST
                   EXIT PERFORM
               END-IF
           END-PERFORM
           MOVE LK-TEXT(LS-FIRST:1) TO LS-CH
           IF LS-CH = "=" OR "+" OR "-" OR "@" OR X"09" OR X"0D"
               MOVE 2 TO LK-RC
               MOVE LS-FIRST TO LK-POS
           END-IF.
       END PROGRAM ALZTEXT.
