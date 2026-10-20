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
      * Country code + IBAN length (SWIFT IBAN registry, all 88
      * countries), read-only and sorted for SEARCH ALL.
       01  WS-COUNTRY-DATA.
           05  FILLER PIC X(40)
               VALUE "AD24AE23AL28AT20AZ28BA20BE16BG22BH22BI27".
           05  FILLER PIC X(40)
               VALUE "BR29BY28CH21CR22CY28CZ24DE22DJ27DK18DO28".
           05  FILLER PIC X(40)
               VALUE "EE20EG29ES24FI18FK18FO18FR27GB22GE22GI23".
           05  FILLER PIC X(40)
               VALUE "GL18GR27GT28HR21HU28IE22IL23IQ23IS26IT27".
           05  FILLER PIC X(40)
               VALUE "JO30KW30KZ20LB28LC32LI21LT20LU20LV21LY25".
           05  FILLER PIC X(40)
               VALUE "MC27MD24ME22MK19MN20MR27MT31MU30NI28NL18".
           05  FILLER PIC X(40)
               VALUE "NO15OM23PK24PL28PS29PT25QA29RO24RS22RU33".
           05  FILLER PIC X(40)
               VALUE "SA24SC31SD18SE24SI19SK24SM27SO23ST25SV28".
           05  FILLER PIC X(32)
               VALUE "TL23TN24TR26UA29VA22VG24XK20YE30".
       01  WS-COUNTRY-TABLE REDEFINES WS-COUNTRY-DATA.
           05  WS-COUNTRY OCCURS 88 TIMES
                   ASCENDING KEY IS WS-CC INDEXED BY CX.
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
           SEARCH ALL WS-COUNTRY
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
      *
      * MOD 97-10 only ever produces check digits 02 to 98. 00, 01 and
      * 99 can still satisfy the remainder test, which would give one
      * account two valid IBANs (FR02... and FR99... for the same
      * BBAN) and let a transfer dodge the same-account and per-sender
      * checks: ISO 13616 treats them as invalid, and so do we.
       3000-CHECK-DIGITS.
           IF LK-IBAN(3:2) = "00" OR "01" OR "99"
               MOVE 3 TO LK-RC
           END-IF
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
