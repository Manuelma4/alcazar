      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TXNGUARD.
      *================================================================
      * TXNGUARD - validate a batch of transfers, pseudonymise the
      *            accounts and seal every decision in the HMAC-chained
      *            audit ledger (Seal).
      *
      *   stdin  K-ledger, then K-token: one line of 64 lower-case hex
      *          digits each (the master key stays in Gatehouse); then
      *          the batch: one 200-byte record per line. Raw card
      *          numbers never touch the disk, and no input file sits
      *          in the job directory for anyone to rewrite.
      *   args   the job id: 1-32 characters from a-z 0-9 -
      *
      *   out    ACCEPTED.DAT  normalised, pseudonymised transfers
      *          REJECTED.DAT  one line per rejected record
      *          LEDGER.DAT    one HMAC-sealed line per record, which
      *                        also seals its ACCEPTED or REJECTED
      *                        record (ledger format v2)
      *          SUMMARY.DAT   KEY=VALUE run summary
      *   stdout ALZ-SEAL|ENTRIES=nnnnnn|HEAD=<64 hex> when the run
      *          ends with 0 or 4: the anchor, through a pipe the
      *          caller owns rather than a file in the job directory
      *
      *   Return codes   0 all accepted      4 some rejected
      *                  8 input error      12 key or self-test error
      *                 16 I/O error
      *
      * Defence in depth: Gatehouse checks the structure of every
      * field first, and this program re-validates everything anyway -
      * it never trusts the front end.
      *================================================================
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-JOB-CHAR IS "abcdefghijklmnopqrstuvwxyz"
                                 "0123456789" "-"
           CLASS ALZ-HEX      IS "0123456789abcdef".
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
      *    Sealed outputs are fixed-length records that end in a line
      *    feed: LINE SEQUENTIAL would trim trailing blanks on WRITE,
      *    and its readers see a normalised view of the file, not its
      *    bytes. These files hold exactly the bytes that were MACed.
           SELECT TXN-OK   ASSIGN TO "ACCEPTED.DAT"
                           ORGANIZATION IS SEQUENTIAL
                           FILE STATUS IS WS-FS-OK.
           SELECT TXN-REJ  ASSIGN TO "REJECTED.DAT"
                           ORGANIZATION IS SEQUENTIAL
                           FILE STATUS IS WS-FS-REJ.
           SELECT LEDGER   ASSIGN TO "LEDGER.DAT"
                           ORGANIZATION IS SEQUENTIAL
                           FILE STATUS IS WS-FS-LEDGER.
           SELECT SUMMARY  ASSIGN TO "SUMMARY.DAT"
                           ORGANIZATION IS LINE SEQUENTIAL
                           FILE STATUS IS WS-FS-SUMMARY.
       DATA DIVISION.
       FILE SECTION.
       FD  TXN-OK.
       COPY ALZACCPT.
       FD  TXN-REJ.
       COPY ALZREJ.
       FD  LEDGER.
       01  LEDGER-RECORD               PIC X(313).
       FD  SUMMARY.
       01  SUMMARY-RECORD              PIC X(80).

       WORKING-STORAGE SECTION.
       COPY ALZCAPI.
       COPY ALZKEYW.
      * The record being judged, read from stdin with alz_read_line
      * (read(2), no stdio copy) and wiped once judged.
       COPY ALZTXNIN.
       01  WS-LINE-CAP                 PIC S9(9) COMP-5 VALUE 200.
       01  WS-LINE-LEN                 PIC S9(9) COMP-5.
       01  WS-RECORD-LEN               PIC S9(9) COMP-5 VALUE 200.
       COPY ALZLEDG.
       01  WS-MAX-RECORDS              PIC 9(4) VALUE 1000.
      * Single-transfer limits in minor units, per currency:
      * 1,000,000.00 in EUR, USD, GBP, CHF, CAD, AUD and NZD, round
      * local figures near EUR 1,000,000 elsewhere (1,000,000.00 HUF
      * is about EUR 2,500). A currency outside the table - refused
      * with E501 just after - is held to the default, 1,000,000.00.
       01  WS-LIMIT-TABLE.
           05  FILLER  PIC X(18) VALUE "EUR000000100000000".
           05  FILLER  PIC X(18) VALUE "USD000000100000000".
           05  FILLER  PIC X(18) VALUE "GBP000000100000000".
           05  FILLER  PIC X(18) VALUE "CHF000000100000000".
           05  FILLER  PIC X(18) VALUE "SEK000001000000000".
           05  FILLER  PIC X(18) VALUE "NOK000001000000000".
           05  FILLER  PIC X(18) VALUE "DKK000000750000000".
           05  FILLER  PIC X(18) VALUE "PLN000000400000000".
           05  FILLER  PIC X(18) VALUE "CZK000002500000000".
           05  FILLER  PIC X(18) VALUE "HUF000040000000000".
           05  FILLER  PIC X(18) VALUE "RON000000500000000".
           05  FILLER  PIC X(18) VALUE "CAD000000100000000".
           05  FILLER  PIC X(18) VALUE "AUD000000100000000".
           05  FILLER  PIC X(18) VALUE "NZD000000100000000".
       01  WS-LIMITS REDEFINES WS-LIMIT-TABLE.
           05  WS-LIMIT-ENTRY          OCCURS 14 TIMES
                                       INDEXED BY WS-LX.
               10  WS-LIMIT-CCY        PIC X(3).
               10  WS-LIMIT-VALUE      PIC 9(15).
       01  WS-DEFAULT-LIMIT            PIC 9(15) VALUE 100000000.
       01  WS-LIMIT-CENTS              PIC 9(15).
       01  WS-FILE-STATUS.
           05  WS-FS-OK                PIC XX.
           05  WS-FS-REJ               PIC XX.
           05  WS-FS-LEDGER            PIC XX.
           05  WS-FS-SUMMARY           PIC XX.
       01  WS-SWITCHES.
           05  WS-EOF-SW               PIC X VALUE "N".
               88  WS-EOF              VALUE "Y".
           05  WS-OPEN-SW              PIC X VALUE "N".
               88  WS-FILES-OPEN       VALUE "Y".
           05  WS-DUPLICATE-SW         PIC X VALUE "N".
               88  WS-DUPLICATE        VALUE "Y".
       01  WS-RETURN-CODE              PIC 99 VALUE 0.
       01  WS-COUNTERS.
           05  WS-RECORDS              PIC 9(6) VALUE 0.
           05  WS-ACCEPTED             PIC 9(6) VALUE 0.
           05  WS-REJECTED             PIC 9(6) VALUE 0.
           05  WS-SEALED               PIC 9(6) VALUE 0.
       01  WS-PREV-MAC                 PIC X(64).

      * The record being judged.
       01  WS-REASON                   PIC X(4).
           88  WS-VALID                VALUE "A000".
       01  WS-FIELD                    PIC X(12).
       01  WS-DETAIL                   PIC X(30).
       01  WS-POS-EDIT                 PIC 9(3).
       01  WS-SIGN                     PIC X.
       01  WS-CENTS                    PIC 9(15) COMP-3.
       01  WS-AMOUNT-RC                PIC S9(9) COMP-5.
       01  WS-WORK                     PIC X(34).
       01  WS-WORK-LEN                 PIC S9(9) COMP-5.
      * "Now" in UTC seconds; TXN-TS is UTC. FUNCTION CURRENT-DATE is
      * local time followed by the offset from UTC (+HHMM / -HHMM).
       01  WS-NOW                      PIC X(21).
       01  WS-NOW-PARTS REDEFINES WS-NOW.
           05  WS-NOW-DATE             PIC 9(8).
           05  WS-NOW-HOUR             PIC 99.
           05  WS-NOW-MINUTE           PIC 99.
           05  WS-NOW-SECOND           PIC 99.
           05  FILLER                  PIC 99.
           05  WS-NOW-OFFSET-SIGN      PIC X.
           05  WS-NOW-OFFSET-HOUR      PIC 99.
           05  WS-NOW-OFFSET-MINUTE    PIC 99.
       01  WS-NOW-UTC-SECONDS          PIC S9(12) COMP-3.
       01  WS-OFFSET-SECONDS           PIC S9(6) COMP-3.
       01  WS-TS-PARTS.
           05  WS-TS-DATE              PIC 9(8).
           05  WS-TS-HOUR              PIC 99.
           05  WS-TS-MINUTE            PIC 99.
           05  WS-TS-SECOND            PIC 99.
       01  WS-TS-SECONDS               PIC S9(12) COMP-3.

      * Transaction ids seen in this batch (replay detection).
       01  WS-SEEN-COUNT               PIC 9(4) VALUE 0.
       01  WS-SEEN-TABLE.
           05  WS-SEEN-ID              PIC X(12) OCCURS 1000 TIMES.
       01  WS-SX                       PIC 9(4).

      * Accepted totals per currency (ALZCCY allows 15 currencies).
       01  WS-TOTAL-COUNT              PIC 99 VALUE 0.
       01  WS-TOTALS.
           05  WS-TOTAL OCCURS 20 TIMES.
               10  WS-TOTAL-CCY        PIC X(3).
               10  WS-TOTAL-CENTS      PIC 9(18) COMP-3.
       01  WS-TX                       PIC 99.

      * Summary lines.
       01  WS-LABEL                    PIC X(20).
       01  WS-SEAL-LINE                PIC X(100).
       01  WS-NUMBER                   PIC 9(18).
       01  WS-NUM-EDIT                 PIC Z(17)9.

       PROCEDURE DIVISION.
       0000-MAIN.
           MOVE "TXNGUARD" TO ALZ-PROGRAM-NAME
           SET ALZ-NEEDS-TOKEN-KEY TO TRUE
           SET ALZ-INPUT-FOLLOWS TO TRUE
           PERFORM ALZ-PREPARE-KEYS
           IF ALZ-KEYS-READY
               MOVE ALZ-GENESIS TO WS-PREV-MAC
               PERFORM 1100-NOW-IN-UTC
               PERFORM 1000-OPEN-FILES
           ELSE
               MOVE 12 TO WS-RETURN-CODE
           END-IF
           IF WS-RETURN-CODE = 0
               PERFORM 2000-NEXT-RECORD UNTIL WS-EOF
           END-IF
           PERFORM 9000-FINISH
           MOVE WS-RETURN-CODE TO RETURN-CODE
           STOP RUN.

       1000-OPEN-FILES.
           OPEN OUTPUT TXN-OK TXN-REJ LEDGER SUMMARY
           SET WS-FILES-OPEN TO TRUE
           IF WS-FS-OK NOT = "00" OR WS-FS-REJ NOT = "00"
              OR WS-FS-LEDGER NOT = "00"
              OR WS-FS-SUMMARY NOT = "00"
               DISPLAY "TXNGUARD: cannot create the output files"
                   UPON SYSERR
               MOVE 16 TO WS-RETURN-CODE
           END-IF.

       1100-NOW-IN-UTC.
           MOVE FUNCTION CURRENT-DATE TO WS-NOW
           COMPUTE WS-NOW-UTC-SECONDS =
               FUNCTION INTEGER-OF-DATE(WS-NOW-DATE) * 86400
               + WS-NOW-HOUR * 3600 + WS-NOW-MINUTE * 60 + WS-NOW-SECOND
           MOVE 0 TO WS-OFFSET-SECONDS
           IF WS-NOW-OFFSET-HOUR IS NUMERIC
              AND WS-NOW-OFFSET-MINUTE IS NUMERIC
               COMPUTE WS-OFFSET-SECONDS =
                   WS-NOW-OFFSET-HOUR * 3600 + WS-NOW-OFFSET-MINUTE * 60
           END-IF
           EVALUATE WS-NOW-OFFSET-SIGN
               WHEN "+"
                   SUBTRACT WS-OFFSET-SECONDS FROM WS-NOW-UTC-SECONDS
               WHEN "-"
                   ADD WS-OFFSET-SECONDS TO WS-NOW-UTC-SECONDS
           END-EVALUATE.

      * One record per line on stdin. A short line keeps the LOW-VALUES
      * of the pre-fill, which the structural check (E901) rejects. A
      * line longer than a record, or input that ends inside a line,
      * means the stream itself is wrong: the whole batch is refused
      * (8) - the rest of an over-long line must never become a record.
       2000-NEXT-RECORD.
           MOVE LOW-VALUES TO TXN-IN-REC
           CALL "alz_read_line" USING TXN-IN-REC WS-LINE-CAP
                                      WS-LINE-LEN
                            RETURNING ALZ-RC
           EVALUATE TRUE
               WHEN ALZ-OK
                   PERFORM 2100-JUDGE-RECORD
               WHEN ALZ-RC = -4
                   SET WS-EOF TO TRUE
               WHEN ALZ-RC = -3 OR ALZ-RC = -6
                   DISPLAY "TXNGUARD: input line too long or cut short"
                       UPON SYSERR
                   MOVE 8 TO WS-RETURN-CODE
                   SET WS-EOF TO TRUE
               WHEN OTHER
                   DISPLAY "TXNGUARD: cannot read stdin" UPON SYSERR
                   MOVE 16 TO WS-RETURN-CODE
                   SET WS-EOF TO TRUE
           END-EVALUATE
      *    The record holds a raw card number: wipe it once judged.
           CALL "alz_zeroize" USING TXN-IN-REC WS-RECORD-LEN
                          RETURNING ALZ-WIPE-RC.

       2100-JUDGE-RECORD.
           ADD 1 TO WS-RECORDS
           IF WS-RECORDS > WS-MAX-RECORDS
               DISPLAY "TXNGUARD: more than 1000 records in one batch"
                   UPON SYSERR
               MOVE 8 TO WS-RETURN-CODE
               SET WS-EOF TO TRUE
           ELSE
               PERFORM 3000-VALIDATE
               IF WS-VALID
                   PERFORM 4000-WRITE-ACCEPTED
               ELSE
                   PERFORM 4500-WRITE-REJECTED
               END-IF
               PERFORM 5000-SEAL-LEDGER
           END-IF.

      *----------------------------------------------------------------
      * Validation: the first failing check decides the reason code.
      *----------------------------------------------------------------
       3000-VALIDATE.
           MOVE "A000" TO WS-REASON
           MOVE SPACES TO WS-FIELD
           MOVE SPACES TO WS-DETAIL
           PERFORM 3100-CHECK-RECORD
           IF WS-VALID
               PERFORM 3200-CHECK-ID
           END-IF
           IF WS-VALID
               PERFORM 3300-CHECK-TIMESTAMP
           END-IF
           IF WS-VALID
               PERFORM 3400-CHECK-ACCOUNTS
           END-IF
      *    The amount is parsed for every record: the ledger records
      *    what was attempted, even when another field failed.
           PERFORM 3500-CHECK-AMOUNT
           IF WS-VALID
               PERFORM 3600-CHECK-CURRENCY
           END-IF
           IF WS-VALID
               PERFORM 3700-CHECK-CARD
           END-IF
           IF WS-VALID
               PERFORM 3800-CHECK-CHANNEL
           END-IF
           IF WS-VALID
               PERFORM 3900-CHECK-MEMO
           END-IF.

      * Structure: only printable ASCII anywhere in the record.
       3100-CHECK-RECORD.
           CALL "ALZTEXT" USING BY CONTENT "P"
                                BY REFERENCE TXN-IN-REC ALZ-RC ALZ-POS
           IF ALZ-RC = 1
               MOVE "E901" TO WS-REASON
               MOVE "RECORD" TO WS-FIELD
               PERFORM 3990-POSITION-DETAIL
           END-IF.

       3200-CHECK-ID.
           CALL "ALZTEXT" USING BY CONTENT "I"
                                BY REFERENCE TI-ID ALZ-RC ALZ-POS
           EVALUATE ALZ-RC
               WHEN 0
                   PERFORM 3210-CHECK-REPLAY
               WHEN 1
                   MOVE "E101" TO WS-REASON
                   MOVE "TXN-ID" TO WS-FIELD
                   PERFORM 3990-POSITION-DETAIL
               WHEN OTHER
                   MOVE "E101" TO WS-REASON
                   MOVE "TXN-ID" TO WS-FIELD
                   MOVE "EMPTY" TO WS-DETAIL
           END-EVALUATE.

      * An id may appear once per batch: a second one is a replay.
       3210-CHECK-REPLAY.
           MOVE "N" TO WS-DUPLICATE-SW
           PERFORM VARYING WS-SX FROM 1 BY 1
                   UNTIL WS-SX > WS-SEEN-COUNT
               IF WS-SEEN-ID(WS-SX) = TI-ID
                   SET WS-DUPLICATE TO TRUE
                   EXIT PERFORM
               END-IF
           END-PERFORM
           IF WS-DUPLICATE
               MOVE "E102" TO WS-REASON
               MOVE "TXN-ID" TO WS-FIELD
               MOVE "REPLAY" TO WS-DETAIL
           ELSE
               ADD 1 TO WS-SEEN-COUNT
               MOVE TI-ID TO WS-SEEN-ID(WS-SEEN-COUNT)
           END-IF.

       3300-CHECK-TIMESTAMP.
           CALL "ALZDATE" USING TI-TS ALZ-RC
           EVALUATE ALZ-RC
               WHEN 0
      *            More than 24 hours ahead of now, both in UTC.
                   MOVE TI-TS TO WS-TS-PARTS
                   COMPUTE WS-TS-SECONDS =
                       FUNCTION INTEGER-OF-DATE(WS-TS-DATE) * 86400
                       + WS-TS-HOUR * 3600 + WS-TS-MINUTE * 60
                       + WS-TS-SECOND
                   IF WS-TS-SECONDS > WS-NOW-UTC-SECONDS + 86400
                       MOVE "E202" TO WS-REASON
                       MOVE "TXN-TS" TO WS-FIELD
                       MOVE "FUTURE" TO WS-DETAIL
                   END-IF
               WHEN 1
                   MOVE "E201" TO WS-REASON
                   MOVE "TXN-TS" TO WS-FIELD
                   MOVE "NOT-NUMERIC" TO WS-DETAIL
               WHEN 2
                   MOVE "E201" TO WS-REASON
                   MOVE "TXN-TS" TO WS-FIELD
                   MOVE "NO-SUCH-DATE" TO WS-DETAIL
               WHEN OTHER
                   MOVE "E201" TO WS-REASON
                   MOVE "TXN-TS" TO WS-FIELD
                   MOVE "NO-SUCH-TIME" TO WS-DETAIL
           END-EVALUATE.

       3400-CHECK-ACCOUNTS.
           CALL "ALZIBAN" USING TI-FROM-IBAN ALZ-RC
           EVALUATE ALZ-RC
               WHEN 0
                   CONTINUE
               WHEN 3
                   MOVE "E302" TO WS-REASON
                   MOVE "FROM-IBAN" TO WS-FIELD
                   MOVE "MOD-97" TO WS-DETAIL
               WHEN 2
                   MOVE "E301" TO WS-REASON
                   MOVE "FROM-IBAN" TO WS-FIELD
                   MOVE "COUNTRY-LENGTH" TO WS-DETAIL
               WHEN OTHER
                   MOVE "E301" TO WS-REASON
                   MOVE "FROM-IBAN" TO WS-FIELD
                   MOVE "FORMAT" TO WS-DETAIL
           END-EVALUATE
           IF WS-VALID
               CALL "ALZIBAN" USING TI-TO-IBAN ALZ-RC
               EVALUATE ALZ-RC
                   WHEN 0
                       CONTINUE
                   WHEN 3
                       MOVE "E304" TO WS-REASON
                       MOVE "TO-IBAN" TO WS-FIELD
                       MOVE "MOD-97" TO WS-DETAIL
                   WHEN 2
                       MOVE "E303" TO WS-REASON
                       MOVE "TO-IBAN" TO WS-FIELD
                       MOVE "COUNTRY-LENGTH" TO WS-DETAIL
                   WHEN OTHER
                       MOVE "E303" TO WS-REASON
                       MOVE "TO-IBAN" TO WS-FIELD
                       MOVE "FORMAT" TO WS-DETAIL
               END-EVALUATE
           END-IF
           IF WS-VALID AND TI-FROM-IBAN = TI-TO-IBAN
               MOVE "E305" TO WS-REASON
               MOVE "TO-IBAN" TO WS-FIELD
               MOVE "SAME-ACCOUNT" TO WS-DETAIL
           END-IF.

       3500-CHECK-AMOUNT.
           CALL "ALZAMNT" USING TI-AMOUNT WS-SIGN WS-CENTS
                                WS-AMOUNT-RC ALZ-POS
           PERFORM 3550-FIND-LIMIT
           IF WS-VALID
               EVALUATE TRUE
                   WHEN WS-AMOUNT-RC = 1
                       MOVE "E401" TO WS-REASON
                       MOVE "AMOUNT" TO WS-FIELD
                       PERFORM 3990-POSITION-DETAIL
                   WHEN WS-AMOUNT-RC = 2
                       MOVE "E402" TO WS-REASON
                       MOVE "AMOUNT" TO WS-FIELD
                       MOVE "MORE-THAN-13-DIGITS" TO WS-DETAIL
                   WHEN WS-SIGN = "-" OR WS-CENTS = 0
                       MOVE "E403" TO WS-REASON
                       MOVE "AMOUNT" TO WS-FIELD
                       MOVE "NOT-POSITIVE" TO WS-DETAIL
                   WHEN WS-CENTS > WS-LIMIT-CENTS
                       MOVE "E404" TO WS-REASON
                       MOVE "AMOUNT" TO WS-FIELD
                       MOVE "OVER-LIMIT" TO WS-DETAIL
               END-EVALUATE
           END-IF.

       3550-FIND-LIMIT.
           MOVE WS-DEFAULT-LIMIT TO WS-LIMIT-CENTS
           SET WS-LX TO 1
           SEARCH WS-LIMIT-ENTRY
               WHEN WS-LIMIT-CCY(WS-LX) = TI-CURRENCY
                   MOVE WS-LIMIT-VALUE(WS-LX) TO WS-LIMIT-CENTS
           END-SEARCH.

       3600-CHECK-CURRENCY.
           CALL "ALZCCY" USING TI-CURRENCY ALZ-RC
           IF ALZ-RC NOT = 0
               MOVE "E501" TO WS-REASON
               MOVE "CURRENCY" TO WS-FIELD
               MOVE "NOT-ALLOWED" TO WS-DETAIL
           END-IF.

       3700-CHECK-CARD.
           IF TI-PAN NOT = SPACES
               CALL "ALZLUHN" USING TI-PAN ALZ-RC
               EVALUATE ALZ-RC
                   WHEN 1
                       MOVE "E601" TO WS-REASON
                       MOVE "CARD-PAN" TO WS-FIELD
                       MOVE "FORMAT" TO WS-DETAIL
                   WHEN 2
                       MOVE "E602" TO WS-REASON
                       MOVE "CARD-PAN" TO WS-FIELD
                       MOVE "LUHN" TO WS-DETAIL
               END-EVALUATE
           END-IF.

       3800-CHECK-CHANNEL.
           IF NOT TI-CHANNEL-VALID
               MOVE "E701" TO WS-REASON
               MOVE "CHANNEL" TO WS-FIELD
               MOVE "UNKNOWN" TO WS-DETAIL
           END-IF.

       3900-CHECK-MEMO.
           IF TI-MEMO NOT = SPACES
               CALL "ALZTEXT" USING BY CONTENT "S"
                                    BY REFERENCE TI-MEMO ALZ-RC ALZ-POS
               IF ALZ-RC = 1
                   MOVE "E801" TO WS-REASON
                   MOVE "MEMO" TO WS-FIELD
                   PERFORM 3990-POSITION-DETAIL
               ELSE
                   CALL "ALZTEXT" USING BY CONTENT "F"
                                        BY REFERENCE TI-MEMO ALZ-RC
                                                     ALZ-POS
                   IF ALZ-RC = 2
                       MOVE "E802" TO WS-REASON
                       MOVE "MEMO" TO WS-FIELD
                       MOVE "FORMULA-PREFIX" TO WS-DETAIL
                   ELSE
      *                A card number typed into the memo would leave
      *                the core in clear text: refuse the transfer.
                       CALL "ALZPANSC" USING TI-MEMO ALZ-RC ALZ-POS
                       IF ALZ-RC = 1
                           MOVE "E803" TO WS-REASON
                           MOVE "MEMO" TO WS-FIELD
                           PERFORM 3990-POSITION-DETAIL
                       END-IF
                   END-IF
               END-IF
           END-IF.

       3990-POSITION-DETAIL.
           COMPUTE WS-POS-EDIT = ALZ-POS
               ON SIZE ERROR
                   MOVE 999 TO WS-POS-EDIT
           END-COMPUTE
           MOVE SPACES TO WS-DETAIL
           STRING "POS=" WS-POS-EDIT DELIMITED BY SIZE INTO WS-DETAIL.

      *----------------------------------------------------------------
      * Outputs.
      *----------------------------------------------------------------
       4000-WRITE-ACCEPTED.
           MOVE SPACES TO TXN-OK-REC
           MOVE TI-ID TO TA-ID
           MOVE TI-TS TO TA-TS
           MOVE TI-FROM-IBAN TO WS-WORK
           PERFORM 4100-ACCOUNT-TOKEN
           MOVE ALZ-MAC-HEX(1:16) TO TA-FROM-TOKEN
           MOVE TI-TO-IBAN TO WS-WORK
           PERFORM 4100-ACCOUNT-TOKEN
           MOVE ALZ-MAC-HEX(1:16) TO TA-TO-TOKEN
           CALL "ALZMASK" USING BY CONTENT "I"
                                BY REFERENCE TI-FROM-IBAN TA-FROM-MASKED
           CALL "ALZMASK" USING BY CONTENT "I"
                                BY REFERENCE TI-TO-IBAN TA-TO-MASKED
           MOVE WS-CENTS TO TA-AMOUNT-CENTS
           MOVE TI-CURRENCY TO TA-CURRENCY
           MOVE TI-CHANNEL TO TA-CHANNEL
           IF TI-PAN NOT = SPACES
               CALL "ALZMASK" USING BY CONTENT "P"
                                    BY REFERENCE TI-PAN TA-PAN-MASKED
           END-IF
           MOVE TI-MEMO TO TA-MEMO
           MOVE X"0A" TO TA-EOL
           MOVE TA-DATA TO ALZ-REC-DATA
           MOVE 206 TO ALZ-REC-LEN
           PERFORM 4800-RECORD-MAC
           WRITE TXN-OK-REC
           IF WS-FS-OK NOT = "00"
               PERFORM 8000-WRITE-FAILED
           END-IF
           ADD 1 TO WS-ACCEPTED
           PERFORM 4200-ADD-TOTAL.

      * Pseudonymous account id: HMAC-SHA256(K-token, IBAN). Stable
      * for one key, and not linkable to the IBAN without that key.
       4100-ACCOUNT-TOKEN.
           MOVE 0 TO WS-WORK-LEN
           INSPECT WS-WORK TALLYING WS-WORK-LEN
               FOR CHARACTERS BEFORE INITIAL SPACE
           MOVE 32 TO ALZ-KEY-LEN
           CALL "alz_hmac_sha256_hex" USING ALZ-TOKEN-KEY ALZ-KEY-LEN
                                            WS-WORK WS-WORK-LEN
                                            ALZ-MAC-HEX
                                  RETURNING ALZ-RC
           IF NOT ALZ-OK
               DISPLAY "TXNGUARD: token derivation failed" UPON SYSERR
               MOVE 12 TO WS-RETURN-CODE
               SET WS-EOF TO TRUE
           END-IF.

       4200-ADD-TOTAL.
           PERFORM VARYING WS-TX FROM 1 BY 1
                   UNTIL WS-TX > WS-TOTAL-COUNT
               IF WS-TOTAL-CCY(WS-TX) = TI-CURRENCY
                   EXIT PERFORM
               END-IF
           END-PERFORM
           IF WS-TX > WS-TOTAL-COUNT
               ADD 1 TO WS-TOTAL-COUNT
               MOVE TI-CURRENCY TO WS-TOTAL-CCY(WS-TX)
               MOVE 0 TO WS-TOTAL-CENTS(WS-TX)
           END-IF
           ADD WS-CENTS TO WS-TOTAL-CENTS(WS-TX)
               ON SIZE ERROR
                   DISPLAY "TXNGUARD: currency total overflow"
                       UPON SYSERR
                   MOVE 8 TO WS-RETURN-CODE
                   SET WS-EOF TO TRUE
           END-ADD.

       4500-WRITE-REJECTED.
           MOVE SPACES TO TXN-REJ-REC
           MOVE WS-RECORDS TO TR-LINE
           MOVE TI-ID TO TR-ID
           CALL "ALZSANIT" USING BY CONTENT "I" BY REFERENCE TR-ID
           MOVE WS-REASON TO TR-CODE
           MOVE WS-FIELD TO TR-FIELD
           MOVE WS-DETAIL TO TR-DETAIL
           MOVE X"0A" TO TR-EOL
           MOVE TR-DATA TO ALZ-REC-DATA
           MOVE 64 TO ALZ-REC-LEN
           PERFORM 4800-RECORD-MAC
           WRITE TXN-REJ-REC
           IF WS-FS-REJ NOT = "00"
               PERFORM 8000-WRITE-FAILED
           END-IF
           ADD 1 TO WS-REJECTED.

      * The record MAC goes into this record's ledger entry: editing
      * the record later breaks the link even though the chain holds.
       4800-RECORD-MAC.
           PERFORM ALZ-RECORD-MAC
           IF NOT ALZ-OK
               DISPLAY "TXNGUARD: record MAC failed" UPON SYSERR
               MOVE 12 TO WS-RETURN-CODE
               SET WS-EOF TO TRUE
           END-IF.

      * Every record, accepted or rejected, is sealed: the MAC covers
      * the entry and the previous MAC, so editing, deleting or
      * reordering any entry breaks the chain from that point on.
      * Untrusted fields are sanitised and masked before they are
      * written: no raw card number or IBAN ever reaches the ledger.
       5000-SEAL-LEDGER.
           MOVE WS-RECORDS TO LG-SEQ
           IF WS-VALID
               SET LG-ACCEPTED TO TRUE
           ELSE
               SET LG-REJECTED TO TRUE
           END-IF
           MOVE TI-ID TO LG-ID
           CALL "ALZSANIT" USING BY CONTENT "I" BY REFERENCE LG-ID
           MOVE TI-TS TO LG-TS
           CALL "ALZSANIT" USING BY CONTENT "D" BY REFERENCE LG-TS
           MOVE WS-REASON TO LG-CODE
      *    The sign is sealed too: "-500.00" is recorded as an attempt
      *    to move -500.00, not 500.00.
           IF WS-AMOUNT-RC = 0
               MOVE WS-SIGN TO LG-SIGN
               MOVE WS-CENTS TO LG-AMOUNT-CENTS
           ELSE
               MOVE "?" TO LG-SIGN
               MOVE 0 TO LG-AMOUNT-CENTS
           END-IF
           MOVE TI-CURRENCY TO LG-CURRENCY
           CALL "ALZSANIT" USING BY CONTENT "A"
                                 BY REFERENCE LG-CURRENCY
           MOVE TI-FROM-IBAN TO WS-WORK
           CALL "ALZSANIT" USING BY CONTENT "N" BY REFERENCE WS-WORK
           CALL "ALZMASK" USING BY CONTENT "I"
                                BY REFERENCE WS-WORK LG-FROM-MASKED
           MOVE TI-PAN TO WS-WORK
           CALL "ALZSANIT" USING BY CONTENT "D" BY REFERENCE WS-WORK
           CALL "ALZMASK" USING BY CONTENT "L"
                                BY REFERENCE WS-WORK LG-PAN-LAST4
           MOVE ALZ-REC-MAC TO LG-RECORD-MAC
           MOVE WS-PREV-MAC TO LG-PREV-MAC
           MOVE 32 TO ALZ-KEY-LEN
           MOVE 247 TO ALZ-MSG-LEN
           CALL "alz_hmac_sha256_hex" USING ALZ-LEDGER-KEY ALZ-KEY-LEN
                                            LG-MAC-INPUT ALZ-MSG-LEN
                                            LG-MAC
                                  RETURNING ALZ-RC
           IF NOT ALZ-OK
               DISPLAY "TXNGUARD: ledger MAC failed" UPON SYSERR
               MOVE 12 TO WS-RETURN-CODE
               SET WS-EOF TO TRUE
           ELSE
               WRITE LEDGER-RECORD FROM LEDGER-LINE
               IF WS-FS-LEDGER NOT = "00"
                   PERFORM 8000-WRITE-FAILED
               ELSE
                   MOVE LG-MAC TO WS-PREV-MAC
                   ADD 1 TO WS-SEALED
               END-IF
           END-IF.

       8000-WRITE-FAILED.
           DISPLAY "TXNGUARD: write error" UPON SYSERR
           MOVE 16 TO WS-RETURN-CODE
           SET WS-EOF TO TRUE.

      *----------------------------------------------------------------
      * End of job.
      *----------------------------------------------------------------
      * Data files are closed - and their statuses checked - before the
      * summary is written: a full disk or a file-size limit often
      * surfaces only when CLOSE flushes the last buffer, and a summary
      * must never vouch for a ledger that was cut short.
       9000-FINISH.
           IF WS-RETURN-CODE = 0 AND WS-REJECTED > 0
               MOVE 4 TO WS-RETURN-CODE
           END-IF
           IF WS-FILES-OPEN
               CLOSE TXN-OK
               IF WS-FS-OK NOT = "00"
                   PERFORM 8000-WRITE-FAILED
               END-IF
               CLOSE TXN-REJ
               IF WS-FS-REJ NOT = "00"
                   PERFORM 8000-WRITE-FAILED
               END-IF
               CLOSE LEDGER
               IF WS-FS-LEDGER NOT = "00"
                   PERFORM 8000-WRITE-FAILED
               END-IF
               PERFORM 9100-WRITE-SUMMARY
               CLOSE SUMMARY
               IF WS-FS-SUMMARY NOT = "00"
                   PERFORM 8000-WRITE-FAILED
               END-IF
           END-IF
           IF WS-RETURN-CODE < 8
               PERFORM 9400-ANNOUNCE-SEAL
           END-IF
           PERFORM ALZ-WIPE-KEYS.

      * The entry count and head MAC once more, on stdout: whoever can
      * rewrite SUMMARY.DAT cannot rewrite what TXNGUARD printed.
       9400-ANNOUNCE-SEAL.
           MOVE SPACES TO WS-SEAL-LINE
           STRING "ALZ-SEAL|ENTRIES=" WS-SEALED "|HEAD=" WS-PREV-MAC
               DELIMITED BY SIZE INTO WS-SEAL-LINE
           DISPLAY FUNCTION TRIM(WS-SEAL-LINE TRAILING).

       9100-WRITE-SUMMARY.
           MOVE "ALZ-SUMMARY=1" TO SUMMARY-RECORD
           PERFORM 9300-WRITE-SUMMARY-LINE
           MOVE SPACES TO SUMMARY-RECORD
           STRING "JOB=" ALZ-JOB-ID DELIMITED BY SPACE
               INTO SUMMARY-RECORD
           PERFORM 9300-WRITE-SUMMARY-LINE
           MOVE "RECORDS" TO WS-LABEL
           MOVE WS-RECORDS TO WS-NUMBER
           PERFORM 9200-NUMBER-LINE
           MOVE "ACCEPTED" TO WS-LABEL
           MOVE WS-ACCEPTED TO WS-NUMBER
           PERFORM 9200-NUMBER-LINE
           MOVE "REJECTED" TO WS-LABEL
           MOVE WS-REJECTED TO WS-NUMBER
           PERFORM 9200-NUMBER-LINE
           PERFORM VARYING WS-TX FROM 1 BY 1
                   UNTIL WS-TX > WS-TOTAL-COUNT
               MOVE SPACES TO WS-LABEL
               STRING "TOTAL-" WS-TOTAL-CCY(WS-TX) DELIMITED BY SIZE
                   INTO WS-LABEL
               MOVE WS-TOTAL-CENTS(WS-TX) TO WS-NUMBER
               PERFORM 9200-NUMBER-LINE
           END-PERFORM
           MOVE "LEDGER-ENTRIES" TO WS-LABEL
           MOVE WS-SEALED TO WS-NUMBER
           PERFORM 9200-NUMBER-LINE
           MOVE SPACES TO SUMMARY-RECORD
           STRING "LEDGER-HEAD=" WS-PREV-MAC DELIMITED BY SIZE
               INTO SUMMARY-RECORD
           PERFORM 9300-WRITE-SUMMARY-LINE
           MOVE "SELFTEST=PASS" TO SUMMARY-RECORD
           PERFORM 9300-WRITE-SUMMARY-LINE
           MOVE "RC" TO WS-LABEL
           MOVE WS-RETURN-CODE TO WS-NUMBER
           PERFORM 9200-NUMBER-LINE.

       9200-NUMBER-LINE.
           MOVE WS-NUMBER TO WS-NUM-EDIT
           MOVE SPACES TO SUMMARY-RECORD
           STRING FUNCTION TRIM(WS-LABEL) "=" FUNCTION TRIM(WS-NUM-EDIT)
               DELIMITED BY SIZE INTO SUMMARY-RECORD
           PERFORM 9300-WRITE-SUMMARY-LINE.

       9300-WRITE-SUMMARY-LINE.
           WRITE SUMMARY-RECORD
           IF WS-FS-SUMMARY NOT = "00"
               PERFORM 8000-WRITE-FAILED
           END-IF.

       COPY ALZKEYP.
       END PROGRAM TXNGUARD.
