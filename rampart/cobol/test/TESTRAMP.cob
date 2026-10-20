      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TESTRAMP.
      *----------------------------------------------------------------
      * TESTRAMP - unit tests for the Rampart COBOL modules and for
      *            the COBOL -> Fortran (C ABI) bridge.
      *            RETURN-CODE = 0 only when every check passes.
      *----------------------------------------------------------------
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       COPY ALZCAPI.
       01  T-CHECKS                    PIC 9(4) VALUE 0.
       01  T-FAILURES                  PIC 9(4) VALUE 0.
       01  T-NAME                      PIC X(40).
       01  T-EXPECT                    PIC S9(9) COMP-5.
       01  T-EXPECT-POS                PIC S9(9) COMP-5.
       01  T-RC                        PIC S9(9) COMP-5.
       01  T-POS                       PIC S9(9) COMP-5.
       01  T-POLICY                    PIC X.
       01  T-TEXT                      PIC X(40).
       01  T-IBAN                      PIC X(34).
       01  T-PAN                       PIC X(19).
       01  T-AMOUNT                    PIC X(18).
       01  T-SIGN                      PIC X.
       01  T-CENTS                     PIC 9(15) COMP-3.
       01  T-WANT-CENTS                PIC 9(15) COMP-3.
       01  T-TS                        PIC X(14).
       01  T-CCY                       PIC X(3).
       01  T-OUT                       PIC X(34).
       01  T-WANT                      PIC X(64).
       01  T-GOT                       PIC X(64).
       01  T-KEY                       PIC X(3) VALUE "key".
       01  T-MSG                       PIC X(3) VALUE "abc".
       01  T-SUMMARY-CHECKS            PIC Z(3)9.
       01  T-SUMMARY-FAILURES          PIC Z(3)9.

       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-TEST-TEXT
           PERFORM 2000-TEST-IBAN
           PERFORM 3000-TEST-LUHN
           PERFORM 4000-TEST-MASK
           PERFORM 5000-TEST-AMOUNT
           PERFORM 6000-TEST-DATE
           PERFORM 7000-TEST-CURRENCY
           PERFORM 8000-TEST-SANITIZE
           PERFORM 8300-TEST-PAN-SCAN
           PERFORM 8500-TEST-KERNEL
           MOVE T-CHECKS TO T-SUMMARY-CHECKS
           MOVE T-FAILURES TO T-SUMMARY-FAILURES
           IF T-FAILURES = 0
               DISPLAY "test_rampart_cob: "
                   FUNCTION TRIM(T-SUMMARY-CHECKS) " checks passed"
               MOVE 0 TO RETURN-CODE
           ELSE
               DISPLAY "test_rampart_cob: "
                   FUNCTION TRIM(T-SUMMARY-FAILURES) " of "
                   FUNCTION TRIM(T-SUMMARY-CHECKS) " checks FAILED"
               MOVE 1 TO RETURN-CODE
           END-IF
           STOP RUN.

       1000-TEST-TEXT.
           MOVE "I" TO T-POLICY
           MOVE "TX-0001" TO T-TEXT
           MOVE "identifier ok" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT
           MOVE "tx-0001" TO T-TEXT
           MOVE "identifier lower case" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT
           MOVE "A;RM" TO T-TEXT
           MOVE "identifier metacharacter" TO T-NAME
           MOVE 2 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT
           MOVE "AB CD" TO T-TEXT
           MOVE "identifier inner space" TO T-NAME
           MOVE 3 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT
           MOVE SPACES TO T-TEXT
           MOVE "identifier empty" TO T-NAME
           MOVE 3 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT

           MOVE "S" TO T-POLICY
           MOVE "Invoice 2025-117" TO T-TEXT
           MOVE "SEPA ok" TO T-NAME
           MOVE 0 TO T-EXPECT
           PERFORM 1900-RUN-TEXT
           MOVE "<img src=x>" TO T-TEXT
           MOVE "SEPA rejects markup" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT
           MOVE "x'; DROP TABLE" TO T-TEXT
           MOVE "SEPA rejects semicolon" TO T-NAME
           MOVE 3 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT

           MOVE "F" TO T-POLICY
           MOVE "-2+3+cmd" TO T-TEXT
           MOVE "formula prefix -" TO T-NAME
           MOVE 2 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT
           MOVE "  =SUM(A1)" TO T-TEXT
           MOVE "formula prefix after spaces" TO T-NAME
           MOVE 3 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT
           MOVE "Invoice" TO T-TEXT
           MOVE "formula none" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT

           MOVE "P" TO T-POLICY
           MOVE SPACES TO T-TEXT
           STRING "abc" X"01" "def" DELIMITED BY SIZE INTO T-TEXT
           MOVE "printable rejects control byte" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 4 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT

           MOVE "H" TO T-POLICY
           MOVE "deadbeef" TO T-TEXT
           MOVE "hex lower case" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT
           MOVE "DEADBEEF" TO T-TEXT
           MOVE "hex upper case rejected" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT

           MOVE "Z" TO T-POLICY
           MOVE "abc" TO T-TEXT
           MOVE "unknown policy" TO T-NAME
           MOVE 9 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 1900-RUN-TEXT.

       1900-RUN-TEXT.
           CALL "ALZTEXT" USING T-POLICY T-TEXT T-RC T-POS
           PERFORM 9000-EXPECT-RC
           IF T-EXPECT-POS NOT = 0
               ADD 1 TO T-CHECKS
               IF T-POS NOT = T-EXPECT-POS
                   ADD 1 TO T-FAILURES
                   DISPLAY "  FAIL " FUNCTION TRIM(T-NAME)
                       " position=" T-POS
               END-IF
           END-IF.

       2000-TEST-IBAN.
           MOVE "FR7630006000011234567890189" TO T-IBAN
           MOVE "IBAN FR valid" TO T-NAME
           MOVE 0 TO T-EXPECT
           PERFORM 2900-RUN-IBAN
           MOVE "DE89370400440532013000" TO T-IBAN
           MOVE "IBAN DE valid" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "GB29NWBK60161331926819" TO T-IBAN
           MOVE "IBAN GB valid (letters in BBAN)" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "NO9386011117947" TO T-IBAN
           MOVE "IBAN NO valid (shortest, 15)" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "MT84MALT011000012345MTLCAST001S" TO T-IBAN
           MOVE "IBAN MT valid (31)" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "QA58DOHB00001234567890ABCDEFG" TO T-IBAN
           MOVE "IBAN QA valid (registry update)" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "JO94CBJO0010000000000131000302" TO T-IBAN
           MOVE "IBAN JO valid (30)" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "FR0230006000011234567890163" TO T-IBAN
           MOVE "IBAN check digits 02 valid" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "FR9930006000011234567890163" TO T-IBAN
           MOVE "IBAN alias with check digits 99" TO T-NAME
           MOVE 3 TO T-EXPECT
           PERFORM 2900-RUN-IBAN
           MOVE "FR7630006000011234567890188" TO T-IBAN
           MOVE "IBAN bad check digits" TO T-NAME
           MOVE 3 TO T-EXPECT
           PERFORM 2900-RUN-IBAN
           MOVE "FR763000600001123456789018" TO T-IBAN
           MOVE "IBAN wrong length for FR" TO T-NAME
           MOVE 2 TO T-EXPECT
           PERFORM 2900-RUN-IBAN
           MOVE "XX7630006000011234567890189" TO T-IBAN
           MOVE "IBAN unknown country" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "fr7630006000011234567890189" TO T-IBAN
           MOVE "IBAN lower case" TO T-NAME
           MOVE 1 TO T-EXPECT
           PERFORM 2900-RUN-IBAN
           MOVE "FR76 3000 6000 0112 3456 7890 189" TO T-IBAN
           MOVE "IBAN with spaces" TO T-NAME
           PERFORM 2900-RUN-IBAN
           MOVE "FR76" TO T-IBAN
           MOVE "IBAN too short" TO T-NAME
           PERFORM 2900-RUN-IBAN.

       2900-RUN-IBAN.
           CALL "ALZIBAN" USING T-IBAN T-RC
           PERFORM 9000-EXPECT-RC.

       3000-TEST-LUHN.
           MOVE "4111111111111111" TO T-PAN
           MOVE "Luhn Visa test card" TO T-NAME
           MOVE 0 TO T-EXPECT
           PERFORM 3900-RUN-LUHN
           MOVE "5555555555554444" TO T-PAN
           MOVE "Luhn Mastercard test card" TO T-NAME
           PERFORM 3900-RUN-LUHN
           MOVE "378282246310005" TO T-PAN
           MOVE "Luhn Amex test card (15)" TO T-NAME
           PERFORM 3900-RUN-LUHN
           MOVE "4111111111111112" TO T-PAN
           MOVE "Luhn bad check digit" TO T-NAME
           MOVE 2 TO T-EXPECT
           PERFORM 3900-RUN-LUHN
           MOVE "41111111111" TO T-PAN
           MOVE "Luhn too short" TO T-NAME
           MOVE 1 TO T-EXPECT
           PERFORM 3900-RUN-LUHN
           MOVE "4111-1111-1111-1111" TO T-PAN
           MOVE "Luhn separators rejected" TO T-NAME
           PERFORM 3900-RUN-LUHN.

       3900-RUN-LUHN.
           CALL "ALZLUHN" USING T-PAN T-RC
           PERFORM 9000-EXPECT-RC.

       4000-TEST-MASK.
           MOVE "4111111111111111" TO T-PAN
           CALL "ALZMASK" USING "P" T-PAN T-OUT
           MOVE "mask card BIN + last 4" TO T-NAME
           MOVE "411111******1111" TO T-WANT
           PERFORM 9100-EXPECT-OUT
           CALL "ALZMASK" USING "L" T-PAN T-OUT
           MOVE "mask card last 4" TO T-NAME
           MOVE "************1111" TO T-WANT
           PERFORM 9100-EXPECT-OUT
           MOVE "411111111111" TO T-PAN
           CALL "ALZMASK" USING "P" T-PAN T-OUT
           MOVE "mask short card keeps last 4 only" TO T-NAME
           MOVE "********1111" TO T-WANT
           PERFORM 9100-EXPECT-OUT
           MOVE "FR7630006000011234567890189" TO T-IBAN
           CALL "ALZMASK" USING "I" T-IBAN T-OUT
           MOVE "mask IBAN" TO T-NAME
           MOVE "FR76*******************0189" TO T-WANT
           PERFORM 9100-EXPECT-OUT
           CALL "ALZMASK" USING "?" T-IBAN T-OUT
           MOVE "mask unknown mode hides all" TO T-NAME
           MOVE ALL "*" TO T-WANT
           MOVE SPACES TO T-WANT(28:)
           PERFORM 9100-EXPECT-OUT.

       5000-TEST-AMOUNT.
           MOVE "125.00" TO T-AMOUNT
           MOVE "amount 125.00" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 12500 TO T-WANT-CENTS
           PERFORM 5900-RUN-AMOUNT
           MOVE "125" TO T-AMOUNT
           MOVE "amount without decimals" TO T-NAME
           PERFORM 5900-RUN-AMOUNT
           MOVE "125.5" TO T-AMOUNT
           MOVE "amount with one decimal" TO T-NAME
           MOVE 12550 TO T-WANT-CENTS
           PERFORM 5900-RUN-AMOUNT
           MOVE "1234567890123.99" TO T-AMOUNT
           MOVE "amount at 13 integer digits" TO T-NAME
           MOVE 123456789012399 TO T-WANT-CENTS
           PERFORM 5900-RUN-AMOUNT
           MOVE "-500.00" TO T-AMOUNT
           MOVE "amount negative keeps its sign" TO T-NAME
           MOVE 50000 TO T-WANT-CENTS
           PERFORM 5900-RUN-AMOUNT
           ADD 1 TO T-CHECKS
           IF T-SIGN NOT = "-"
               ADD 1 TO T-FAILURES
               DISPLAY "  FAIL amount sign lost"
           END-IF
           MOVE "12345678901234.50" TO T-AMOUNT
           MOVE "amount 14 integer digits" TO T-NAME
           MOVE 2 TO T-EXPECT
           MOVE 0 TO T-WANT-CENTS
           PERFORM 5900-RUN-AMOUNT
           MOVE "10.005" TO T-AMOUNT
           MOVE "amount three decimals" TO T-NAME
           MOVE 1 TO T-EXPECT
           PERFORM 5900-RUN-AMOUNT
           MOVE "1e9" TO T-AMOUNT
           MOVE "amount exponent" TO T-NAME
           PERFORM 5900-RUN-AMOUNT
           MOVE SPACES TO T-AMOUNT
           MOVE "amount empty" TO T-NAME
           PERFORM 5900-RUN-AMOUNT
           MOVE "12." TO T-AMOUNT
           MOVE "amount trailing point" TO T-NAME
           PERFORM 5900-RUN-AMOUNT
           MOVE ".50" TO T-AMOUNT
           MOVE "amount leading point" TO T-NAME
           PERFORM 5900-RUN-AMOUNT
           MOVE " 12.00" TO T-AMOUNT
           MOVE "amount leading space" TO T-NAME
           PERFORM 5900-RUN-AMOUNT
           MOVE "12.00 x" TO T-AMOUNT
           MOVE "amount trailing garbage" TO T-NAME
           PERFORM 5900-RUN-AMOUNT
           MOVE "--5" TO T-AMOUNT
           MOVE "amount double sign" TO T-NAME
           PERFORM 5900-RUN-AMOUNT.

       5900-RUN-AMOUNT.
           CALL "ALZAMNT" USING T-AMOUNT T-SIGN T-CENTS T-RC T-POS
           PERFORM 9000-EXPECT-RC
           ADD 1 TO T-CHECKS
           IF T-CENTS NOT = T-WANT-CENTS
               ADD 1 TO T-FAILURES
               DISPLAY "  FAIL " FUNCTION TRIM(T-NAME) " cents=" T-CENTS
           END-IF.

       6000-TEST-DATE.
           MOVE "20251020101500" TO T-TS
           MOVE "date valid" TO T-NAME
           MOVE 0 TO T-EXPECT
           PERFORM 6900-RUN-DATE
           MOVE "20240229000000" TO T-TS
           MOVE "date leap day" TO T-NAME
           PERFORM 6900-RUN-DATE
           MOVE "20250230101500" TO T-TS
           MOVE "date 30 February" TO T-NAME
           MOVE 2 TO T-EXPECT
           PERFORM 6900-RUN-DATE
           MOVE "20230229000000" TO T-TS
           MOVE "date 29 February, not leap" TO T-NAME
           PERFORM 6900-RUN-DATE
           MOVE "20251020246000" TO T-TS
           MOVE "date hour 24" TO T-NAME
           MOVE 3 TO T-EXPECT
           PERFORM 6900-RUN-DATE
           MOVE "2025102010150X" TO T-TS
           MOVE "date not numeric" TO T-NAME
           MOVE 1 TO T-EXPECT
           PERFORM 6900-RUN-DATE.

       6900-RUN-DATE.
           CALL "ALZDATE" USING T-TS T-RC
           PERFORM 9000-EXPECT-RC.

       7000-TEST-CURRENCY.
           MOVE "EUR" TO T-CCY
           MOVE "currency EUR" TO T-NAME
           MOVE 0 TO T-EXPECT
           PERFORM 7900-RUN-CURRENCY
           MOVE "BTC" TO T-CCY
           MOVE "currency BTC" TO T-NAME
           MOVE 1 TO T-EXPECT
           PERFORM 7900-RUN-CURRENCY
           MOVE "eur" TO T-CCY
           MOVE "currency lower case" TO T-NAME
           PERFORM 7900-RUN-CURRENCY
           MOVE "BGN" TO T-CCY
           MOVE "currency BGN (euro since 2026)" TO T-NAME
           PERFORM 7900-RUN-CURRENCY.

       7900-RUN-CURRENCY.
           CALL "ALZCCY" USING T-CCY T-RC
           PERFORM 9000-EXPECT-RC.

       8000-TEST-SANITIZE.
           MOVE "A;rm -rf /" TO T-OUT
           CALL "ALZSANIT" USING "I" T-OUT
           MOVE "sanitize identifier" TO T-NAME
           MOVE "A??? -?? ?" TO T-WANT
           PERFORM 9100-EXPECT-OUT
           MOVE "FR76|X" TO T-OUT
           CALL "ALZSANIT" USING "N" T-OUT
           MOVE "sanitize separator" TO T-NAME
           MOVE "FR76?X" TO T-WANT
           PERFORM 9100-EXPECT-OUT.

       8300-TEST-PAN-SCAN.
           MOVE "card 4111 1111 1111 1111 exp 12/28" TO T-TEXT
           MOVE "PAN with spaces in a memo" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 6 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "pay 4111 - 1111 - 1111 - 1111" TO T-TEXT
           MOVE "PAN joined by spaced hyphens" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 5 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "ref 5555 / 5555 / 5555 / 4444" TO T-TEXT
           MOVE "PAN joined by spaced slashes" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 5 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "ref 1234 - 5678 - 9012" TO T-TEXT
           MOVE "spaced hyphens, too short" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "ref 5555-5555-5555-4444" TO T-TEXT
           MOVE "PAN with hyphens" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 5 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "378282246310005" TO T-TEXT
           MOVE "Amex PAN, 15 digits" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "3782 822463 10005" TO T-TEXT
           MOVE "Amex in groups 4-6-5" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "3056 9309 0259 04" TO T-TEXT
           MOVE "Diners, 14 digits, 4-4-4-2" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "4222 2222 2222 2" TO T-TEXT
           MOVE "Visa, 13 digits, 4-4-4-1" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "4111 1111 1111 1111 123" TO T-TEXT
           MOVE "PAN followed by a CVV" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "card 4111 1111 1111 1111 12/28" TO T-TEXT
           MOVE "PAN followed by an expiry date" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 6 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "12/28 4111 1111 1111 1111" TO T-TEXT
           MOVE "PAN after an expiry date" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 7 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "4111-1111-1111-1111-1228" TO T-TEXT
           MOVE "PAN and expiry, hyphens" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "4111.1111.1111.1111" TO T-TEXT
           MOVE "PAN with dots" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "4111/1111/1111/1111" TO T-TEXT
           MOVE "PAN with slashes" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "4111  1111 1111 1111" TO T-TEXT
           MOVE "two spaces still join groups" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 1 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "card4111 1111 1111 1111" TO T-TEXT
           MOVE "PAN glued to a word" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 5 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "VISA4111111111111111" TO T-TEXT
           MOVE "PAN glued to capitals" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 5 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "PAN4111-1111-1111-1111" TO T-TEXT
           MOVE "PAN glued to PAN" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 4 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "REF A12 4111 1111 1111 1111" TO T-TEXT
           MOVE "PAN after a short code" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 9 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "BE68 5390 0754 7034 4111 1111 1111 1111" TO T-TEXT
           MOVE "PAN right after an IBAN" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 21 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "ref 4111 1111 1111 1111 11" TO T-TEXT
           MOVE "the IBAN's digits outside an IBAN" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 5 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "dankort 5019 1234 5678 9013" TO T-TEXT
           MOVE "Dankort, 16 digits" TO T-NAME
           MOVE 1 TO T-EXPECT
           MOVE 9 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "bancontact 6703 1234 5678 9012 1" TO T-TEXT
           MOVE "Bancontact, 17 digits" TO T-NAME
           MOVE 12 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "borica 2205 1234 5678 9014" TO T-TEXT
           MOVE "BORICA, 16 digits" TO T-NAME
           MOVE 8 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "diners 3095 1234 5678 97" TO T-TEXT
           MOVE "Diners 3095, 14 digits" TO T-NAME
           MOVE 8 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "Invoice 2025-117 order 88412" TO T-TEXT
           MOVE "ordinary numbers are not cards" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "4111 1111 1111 1112" TO T-TEXT
           MOVE "Luhn-invalid run is not a card" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "ref 1111111111111117" TO T-TEXT
           MOVE "no card network starts with 1" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "4111   1111 1111 1111" TO T-TEXT
           MOVE "three spaces break the chain" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "DE89 3704 0044 0532 0130 00" TO T-TEXT
           MOVE "an IBAN is not a card" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "DE89 4111 1111 1111 1111 11" TO T-TEXT
           MOVE "an IBAN that embeds a Visa number" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "refund fr75 0001 4093 1234 5975 1277 407" TO T-TEXT
           MOVE "a lower-case IBAN is not a card" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "RF18 5390 0754 7034" TO T-TEXT
           MOVE "an RF reference is not a card" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "Inv 5234-567 05.10.2025 qty 12" TO T-TEXT
           MOVE "dates never join a number" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "tel 06 12 34 56 78 90 12 34" TO T-TEXT
           MOVE "2-digit groups never join" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "SIRET 552 081 317 00018" TO T-TEXT
           MOVE "a SIRET is not a card" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "SIRET 55208131700018" TO T-TEXT
           MOVE "a SIRET, unspaced, is not a card" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN
           MOVE "IMEI 352099001761481" TO T-TEXT
           MOVE "an IMEI is not a card" TO T-NAME
           MOVE 0 TO T-EXPECT
           MOVE 0 TO T-EXPECT-POS
           PERFORM 8390-RUN-PAN-SCAN.

       8390-RUN-PAN-SCAN.
           CALL "ALZPANSC" USING T-TEXT T-RC T-POS
           PERFORM 9000-EXPECT-RC
           ADD 1 TO T-CHECKS
           IF T-POS NOT = T-EXPECT-POS
               ADD 1 TO T-FAILURES
               DISPLAY "  FAIL " FUNCTION TRIM(T-NAME)
                   " position=" T-POS
           END-IF.

      * The Fortran kernel through the C ABI, exactly as TXNGUARD
      * calls it.
       8500-TEST-KERNEL.
           CALL "alz_selftest" RETURNING ALZ-RC
           MOVE ALZ-RC TO T-RC
           MOVE "kernel power-on self-test" TO T-NAME
           MOVE 0 TO T-EXPECT
           PERFORM 9000-EXPECT-RC

           MOVE 3 TO ALZ-KEY-LEN
           MOVE 3 TO ALZ-MSG-LEN
           CALL "alz_hmac_sha256_hex" USING T-KEY ALZ-KEY-LEN
                                            T-MSG ALZ-MSG-LEN
                                            ALZ-MAC-HEX
                                  RETURNING ALZ-RC
           MOVE ALZ-RC TO T-RC
           MOVE "kernel HMAC status" TO T-NAME
           PERFORM 9000-EXPECT-RC
           MOVE ALZ-MAC-HEX TO T-GOT
           MOVE "9c196e32dc0175f86f4b1cb89289d661"
             TO T-WANT(1:32)
           MOVE "9de6bee699e4c378e68309ed97a1a6ab"
             TO T-WANT(33:32)
           MOVE "kernel HMAC matches OpenSSL" TO T-NAME
           PERFORM 9200-EXPECT-HEX

           MOVE 64 TO ALZ-MSG-LEN
           CALL "alz_ct_equal" USING T-WANT T-GOT ALZ-MSG-LEN
                           RETURNING ALZ-RC
           MOVE ALZ-RC TO T-RC
           MOVE "kernel constant-time equal" TO T-NAME
           MOVE 0 TO T-EXPECT
           PERFORM 9000-EXPECT-RC
           MOVE "0" TO T-GOT(64:1)
           CALL "alz_ct_equal" USING T-WANT T-GOT ALZ-MSG-LEN
                           RETURNING ALZ-RC
           MOVE ALZ-RC TO T-RC
           MOVE "kernel constant-time different" TO T-NAME
           MOVE 1 TO T-EXPECT
           PERFORM 9000-EXPECT-RC

           MOVE -1 TO ALZ-MSG-LEN
           CALL "alz_hmac_sha256_hex" USING T-KEY ALZ-KEY-LEN
                                            T-MSG ALZ-MSG-LEN
                                            ALZ-MAC-HEX
                                  RETURNING ALZ-RC
           MOVE ALZ-RC TO T-RC
           MOVE "kernel rejects a negative length" TO T-NAME
           MOVE -1 TO T-EXPECT
           PERFORM 9000-EXPECT-RC.

       9000-EXPECT-RC.
           ADD 1 TO T-CHECKS
           IF T-RC NOT = T-EXPECT
               ADD 1 TO T-FAILURES
               DISPLAY "  FAIL " FUNCTION TRIM(T-NAME)
                   " rc=" T-RC " expected=" T-EXPECT
           END-IF.

       9100-EXPECT-OUT.
           ADD 1 TO T-CHECKS
           IF T-OUT NOT = T-WANT(1:34)
               ADD 1 TO T-FAILURES
               DISPLAY "  FAIL " FUNCTION TRIM(T-NAME)
                   " got [" T-OUT "]"
           END-IF.

       9200-EXPECT-HEX.
           ADD 1 TO T-CHECKS
           IF T-GOT NOT = T-WANT
               ADD 1 TO T-FAILURES
               DISPLAY "  FAIL " FUNCTION TRIM(T-NAME)
                   " got " T-GOT
           END-IF.
       END PROGRAM TESTRAMP.
