      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZIBAN.
      *----------------------------------------------------------------
      * ALZIBAN - validate an IBAN in electronic format (ISO 13616):
      *           structure, country length and the ISO 7064
      *           MOD 97-10 check digits.
      *
      *   CALL "ALZIBAN" USING iban rc
      *
      *   iban  PIC X ANY LENGTH, left-justified, no inner spaces
      *   rc    0 valid
      *         1 bad structure or character
      *         2 unknown country or wrong length for the country
      *         3 check digits do not verify
      *----------------------------------------------------------------
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-ALNUM IS "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                              "0123456789"
           CLASS ALZ-DIGIT IS "0123456789"
           CLASS ALZ-UPPER IS "ABCDEFGHIJKLMNOPQRSTUVWXYZ".
       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * Country code + IBAN length (SWIFT IBAN registry), read-only.
       01  WS-COUNTRY-DATA.
           05  FILLER PIC X(40)
               VALUE "AD24AE23AL28AT20BA20BE16BG22BH22BR29CH21".
           05  FILLER PIC X(40)
               VALUE "CY28CZ24DE22DK18EE20ES24FI18FO18FR27GB22".
           05  FILLER PIC X(40)
               VALUE "GE22GI23GL18GR27HR21HU28IE22IL23IS26IT27".
           05  FILLER PIC X(40)
               VALUE "KZ20LI21LT20LU20LV21MC27MD24ME22MK19MT31".
           05  FILLER PIC X(40)
               VALUE "NL18NO15PL28PT25RO24RS22SA24SE24SI19SK24".
           05  FILLER PIC X(20)
               VALUE "SM27TR26UA29VA22XK20".
       01  WS-COUNTRY-TABLE REDEFINES WS-COUNTRY-DATA.
           05  WS-COUNTRY OCCURS 55 TIMES INDEXED BY CX.
               10  WS-CC               PIC XX.
               10  WS-CC-LEN           PIC 99.
       01  WS-ALPHABET                 PIC X(26)
           VALUE "ABCDEFGHIJKLMNOPQRSTUVWXYZ".
       LOCAL-STORAGE SECTION.
       01  LS-LEN                      PIC S9(9) COMP-5.
       01  LS-I                        PIC S9(9) COMP-5.
       01  LS-REM                      PIC 9(5) COMP-5.
       01  LS-LETTER                   PIC 99.
       01  LS-CH                       PIC X.
       01  LS-DIGIT-X                  PIC X.
       01  LS-DIGIT REDEFINES LS-DIGIT-X PIC 9.
       LINKAGE SECTION.
       01  LK-IBAN                     PIC X ANY LENGTH.
       01  LK-RC                       PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-IBAN LK-RC.
       0000-MAIN.
           MOVE 0 TO LK-RC
           PERFORM 1000-CHECK-STRUCTURE
           IF LK-RC = 0
               PERFORM 2000-CHECK-COUNTRY
           END-IF
           IF LK-RC = 0
               PERFORM 3000-CHECK-DIGITS
           END-IF
           GOBACK.

      * CC + 2 check digits + up to 30 alphanumerics, then spaces.
       1000-CHECK-STRUCTURE.
           MOVE FUNCTION LENGTH(LK-IBAN) TO LS-LEN
           PERFORM UNTIL LS-LEN = 0
               IF LK-IBAN(LS-LEN:1) NOT = SPACE
                   EXIT PERFORM
               END-IF
               SUBTRACT 1 FROM LS-LEN
           END-PERFORM
           IF LS-LEN < 15 OR LS-LEN > 34
               MOVE 1 TO LK-RC
           ELSE
               IF LK-IBAN(1:2) IS NOT ALZ-UPPER
                  OR LK-IBAN(3:2) IS NOT ALZ-DIGIT
                  OR LK-IBAN(5:LS-LEN - 4) IS NOT ALZ-ALNUM
                   MOVE 1 TO LK-RC
               END-IF
           END-IF.

       2000-CHECK-COUNTRY.
           SET CX TO 1
           SEARCH WS-COUNTRY
               AT END
                   MOVE 2 TO LK-RC
               WHEN WS-CC(CX) = LK-IBAN(1:2)
                   IF WS-CC-LEN(CX) NOT = LS-LEN
                       MOVE 2 TO LK-RC
                   END-IF
           END-SEARCH.

      * Move the first four characters to the end, read letters as
      * A = 10 ... Z = 35, and reduce modulo 97 digit by digit so no
      * intermediate exceeds five digits. A valid IBAN leaves 1.
       3000-CHECK-DIGITS.
           MOVE 0 TO LS-REM
           PERFORM VARYING LS-I FROM 5 BY 1 UNTIL LS-I > LS-LEN
               MOVE LK-IBAN(LS-I:1) TO LS-CH
               PERFORM 3100-ADD-CHARACTER
           END-PERFORM
           PERFORM VARYING LS-I FROM 1 BY 1 UNTIL LS-I > 4
               MOVE LK-IBAN(LS-I:1) TO LS-CH
               PERFORM 3100-ADD-CHARACTER
           END-PERFORM
           IF LS-REM NOT = 1
               MOVE 3 TO LK-RC
           END-IF.

       3100-ADD-CHARACTER.
           IF LS-CH IS ALZ-DIGIT
               MOVE LS-CH TO LS-DIGIT-X
               COMPUTE LS-REM = FUNCTION MOD(LS-REM * 10 + LS-DIGIT, 97)
           ELSE
               MOVE 0 TO LS-LETTER
               INSPECT WS-ALPHABET TALLYING LS-LETTER
                   FOR CHARACTERS BEFORE INITIAL LS-CH
               ADD 10 TO LS-LETTER
               COMPUTE LS-REM =
                   FUNCTION MOD(LS-REM * 100 + LS-LETTER, 97)
           END-IF.
       END PROGRAM ALZIBAN.
