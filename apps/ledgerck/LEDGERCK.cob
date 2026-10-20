      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEDGERCK.
      *================================================================
      * LEDGERCK - verify the audit ledger (Seal, format v2): the HMAC
      *            chain, and every ACCEPTED and REJECTED record
      *            against the record MAC its entry seals.
      *
      *   stdin   K-ledger, 64 lower-case hex digits. LEDGERCK never
      *           receives K-token: it cannot compute account tokens.
      *   args    the job id the ledger was sealed for
      *   in      LEDGER.DAT, ACCEPTED.DAT, REJECTED.DAT
      *   stdout  exactly one line:
      *     ALZ-LEDGER|STATUS=OK|ENTRIES=000004|HEAD=<64 hex>
      *     ALZ-LEDGER|STATUS=BROKEN|ENTRIES=000001|SEQ=000002|
      *       REASON=MAC-MISMATCH        (on a single line)
      *
      *   Return codes   0 ledger valid      4 ledger broken
      *                 12 key or self-test error
      *                 16 I/O error
      *
      * Each entry is checked in order: format (FORMAT), sequence
      * number (SEQ-GAP), link to the previous MAC (CHAIN-BREAK), the
      * MAC itself, compared in constant time (MAC-MISMATCH), then the
      * next ACCEPTED or REJECTED record against the record MAC the
      * entry seals (RECORD-MISMATCH). A record left over after the
      * last entry is a RECORD-MISMATCH at the next sequence number.
      * ENTRIES counts the entries verified before the first failure.
      *
      * All three files are read as fixed-length records whose last
      * byte must be a line feed: no reader normalisation (trimmed
      * blanks, stripped CRs, split lines) stands between the bytes
      * on disk and the bytes that are verified.
      *
      * A valid ledger proves no entry or record was edited, removed
      * or reordered. Removing entries and their records from the END
      * leaves a valid, shorter ledger: only the anchored head kept by
      * Gatehouse reveals truncation (docs/THREAT_MODEL.md).
      *================================================================
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-JOB-CHAR IS "abcdefghijklmnopqrstuvwxyz"
                                 "0123456789" "-"
           CLASS ALZ-HEX      IS "0123456789abcdef".
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT LEDGER   ASSIGN TO "LEDGER.DAT"
                           ORGANIZATION IS SEQUENTIAL
                           FILE STATUS IS WS-FS-LEDGER.
           SELECT TXN-OK   ASSIGN TO "ACCEPTED.DAT"
                           ORGANIZATION IS SEQUENTIAL
                           FILE STATUS IS WS-FS-OK.
           SELECT TXN-REJ  ASSIGN TO "REJECTED.DAT"
                           ORGANIZATION IS SEQUENTIAL
                           FILE STATUS IS WS-FS-REJ.
       DATA DIVISION.
       FILE SECTION.
       FD  LEDGER.
       01  LEDGER-RECORD               PIC X(313).
       FD  TXN-OK.
       COPY ALZACCPT.
       FD  TXN-REJ.
       COPY ALZREJ.

       WORKING-STORAGE SECTION.
       COPY ALZCAPI.
       COPY ALZKEYW.
       COPY ALZLEDG.
       01  WS-FS-LEDGER                PIC XX.
       01  WS-FS-OK                    PIC XX.
       01  WS-FS-REJ                   PIC XX.
       01  WS-EOF-SW                   PIC X VALUE "N".
           88  WS-EOF                  VALUE "Y".
       01  WS-LEDGER-SW                PIC X VALUE "N".
           88  WS-LEDGER-OPEN          VALUE "Y".
       01  WS-OK-SW                    PIC X VALUE "N".
           88  WS-OK-OPEN              VALUE "Y".
       01  WS-REJ-SW                   PIC X VALUE "N".
           88  WS-REJ-OPEN             VALUE "Y".
       01  WS-RECORD-SW                PIC X VALUE "N".
           88  WS-RECORD-FOUND         VALUE "Y".
           88  WS-RECORD-MISSING       VALUE "N".
       01  WS-RETURN-CODE              PIC 99 VALUE 0.
       01  WS-VERIFIED                 PIC 9(6) VALUE 0.
       01  WS-EXPECTED-SEQ             PIC 9(6) VALUE 1.
       01  WS-PREV-MAC                 PIC X(64).
       01  WS-COMPUTED-MAC             PIC X(64).
       01  WS-TEXT-RC                  PIC S9(9) COMP-5.
       01  WS-REASON                   PIC X(16) VALUE SPACES.
           88  WS-CHAIN-INTACT         VALUE SPACES.
       01  WS-RESULT                   PIC X(120).

       PROCEDURE DIVISION.
       0000-MAIN.
           MOVE "LEDGERCK" TO ALZ-PROGRAM-NAME
           PERFORM ALZ-PREPARE-KEYS
           IF ALZ-KEYS-READY
               MOVE ALZ-GENESIS TO WS-PREV-MAC
               PERFORM 1000-VERIFY-LEDGER
           ELSE
               MOVE 12 TO WS-RETURN-CODE
           END-IF
           PERFORM ALZ-WIPE-KEYS
           IF WS-RETURN-CODE < 12
               PERFORM 9000-REPORT
           END-IF
           MOVE WS-RETURN-CODE TO RETURN-CODE
           STOP RUN.

      * A missing file reads as empty - TXNGUARD always creates all
      * three - so deleting one is a verdict, not an I/O error: a
      * deleted ledger leaves its records over (RECORD-MISMATCH), a
      * deleted record file starves the first entry that needs it,
      * and deleting everything leaves a valid empty ledger that only
      * the anchor kept by Gatehouse can contradict.
       1000-VERIFY-LEDGER.
           OPEN INPUT LEDGER
           EVALUATE WS-FS-LEDGER
               WHEN "00"
                   SET WS-LEDGER-OPEN TO TRUE
               WHEN "35"
                   SET WS-EOF TO TRUE
               WHEN OTHER
                   DISPLAY "LEDGERCK: cannot open LEDGER.DAT, status "
                       WS-FS-LEDGER UPON SYSERR
                   MOVE 16 TO WS-RETURN-CODE
           END-EVALUATE
           IF WS-RETURN-CODE = 0
               PERFORM 1100-OPEN-RECORDS
           END-IF
           IF WS-RETURN-CODE = 0
               PERFORM 2000-NEXT-ENTRY
                   UNTIL WS-EOF OR NOT WS-CHAIN-INTACT
           END-IF
           IF WS-RETURN-CODE = 0 AND WS-CHAIN-INTACT
               PERFORM 4000-CHECK-LEFTOVERS
           END-IF
           PERFORM 1200-CLOSE-FILES
      *    A kernel or I/O failure (12, 16) is not a verdict on the
      *    ledger: it is reported as such, never as "broken".
           IF WS-RETURN-CODE = 0 AND NOT WS-CHAIN-INTACT
               MOVE 4 TO WS-RETURN-CODE
           END-IF.

       1100-OPEN-RECORDS.
           OPEN INPUT TXN-OK
           EVALUATE WS-FS-OK
               WHEN "00"
                   SET WS-OK-OPEN TO TRUE
               WHEN "35"
                   CONTINUE
               WHEN OTHER
                   DISPLAY "LEDGERCK: cannot open ACCEPTED.DAT,"
                       " status " WS-FS-OK UPON SYSERR
                   MOVE 16 TO WS-RETURN-CODE
           END-EVALUATE
           OPEN INPUT TXN-REJ
           EVALUATE WS-FS-REJ
               WHEN "00"
                   SET WS-REJ-OPEN TO TRUE
               WHEN "35"
                   CONTINUE
               WHEN OTHER
                   DISPLAY "LEDGERCK: cannot open REJECTED.DAT,"
                       " status " WS-FS-REJ UPON SYSERR
                   MOVE 16 TO WS-RETURN-CODE
           END-EVALUATE.

       1200-CLOSE-FILES.
           IF WS-LEDGER-OPEN
               CLOSE LEDGER
           END-IF
           IF WS-OK-OPEN
               CLOSE TXN-OK
           END-IF
           IF WS-REJ-OPEN
               CLOSE TXN-REJ
           END-IF.

      * LOW-VALUES first: a short final record comes back with stale
      * bytes (and status 00 or 04); with LOW-VALUES there, it fails
      * the format check instead.
       2000-NEXT-ENTRY.
           MOVE LOW-VALUES TO LEDGER-RECORD
           READ LEDGER
           EVALUATE WS-FS-LEDGER
               WHEN "00"
               WHEN "04"
               WHEN "06"
                   MOVE LEDGER-RECORD TO LEDGER-LINE
                   PERFORM 3000-CHECK-ENTRY
               WHEN "10"
                   SET WS-EOF TO TRUE
               WHEN OTHER
                   DISPLAY "LEDGERCK: read error, status "
                       WS-FS-LEDGER UPON SYSERR
                   MOVE 16 TO WS-RETURN-CODE
                   SET WS-EOF TO TRUE
           END-EVALUATE.

      * Nested IFs, not AND: COBOL does not promise short-circuit
      * evaluation, and LG-SEQ may only be compared once it is known
      * to be numeric.
       3000-CHECK-ENTRY.
           PERFORM 3100-CHECK-FORMAT
           IF WS-CHAIN-INTACT
               IF LG-SEQ NOT = WS-EXPECTED-SEQ
                   MOVE "SEQ-GAP" TO WS-REASON
               ELSE
                   IF LG-PREV-MAC NOT = WS-PREV-MAC
                       MOVE "CHAIN-BREAK" TO WS-REASON
                   ELSE
                       PERFORM 3200-CHECK-MAC
                       IF WS-CHAIN-INTACT
                           PERFORM 3300-CHECK-RECORD
                       END-IF
                   END-IF
               END-IF
           END-IF
           IF WS-CHAIN-INTACT
               MOVE LG-MAC TO WS-PREV-MAC
               ADD 1 TO WS-VERIFIED
               ADD 1 TO WS-EXPECTED-SEQ
           END-IF.

      * Every separator in place and the line feed at the end, numeric
      * fields numeric, the three MACs exactly 64 lower-case hex
      * digits, and nothing but printable ASCII before the line feed.
       3100-CHECK-FORMAT.
           IF LG-SEP-1 NOT = "|" OR LG-SEP-2 NOT = "|"
              OR LG-SEP-3 NOT = "|" OR LG-SEP-4 NOT = "|"
              OR LG-SEP-5 NOT = "|" OR LG-SEP-6 NOT = "|"
              OR LG-SEP-7 NOT = "|" OR LG-SEP-8 NOT = "|"
              OR LG-SEP-9 NOT = "|" OR LG-SEP-10 NOT = "|"
              OR LG-SEP-11 NOT = "|" OR LG-EOL NOT = X"0A"
              OR LG-SEQ IS NOT NUMERIC
              OR NOT LG-SIGN-VALID
              OR LG-AMOUNT-CENTS IS NOT NUMERIC
              OR NOT (LG-ACCEPTED OR LG-REJECTED)
              OR LG-RECORD-MAC IS NOT ALZ-HEX
              OR LG-PREV-MAC IS NOT ALZ-HEX
              OR LG-MAC IS NOT ALZ-HEX
               MOVE "FORMAT" TO WS-REASON
           ELSE
               CALL "ALZTEXT" USING BY CONTENT "P"
                                    BY REFERENCE LG-TEXT
                                    WS-TEXT-RC ALZ-POS
               IF WS-TEXT-RC NOT = 0
                   MOVE "FORMAT" TO WS-REASON
               END-IF
           END-IF.

       3200-CHECK-MAC.
           MOVE 32 TO ALZ-KEY-LEN
           MOVE 247 TO ALZ-MSG-LEN
           CALL "alz_hmac_sha256_hex" USING ALZ-LEDGER-KEY ALZ-KEY-LEN
                                            LG-MAC-INPUT ALZ-MSG-LEN
                                            WS-COMPUTED-MAC
                                  RETURNING ALZ-RC
           IF NOT ALZ-OK
               PERFORM 8000-KERNEL-FAILED
           ELSE
      *        Constant time: how much of a forged MAC matches must
      *        not show in the running time.
               MOVE 64 TO ALZ-MSG-LEN
               CALL "alz_ct_equal" USING WS-COMPUTED-MAC LG-MAC
                                         ALZ-MSG-LEN
                               RETURNING ALZ-RC
               IF NOT ALZ-OK
                   MOVE "MAC-MISMATCH" TO WS-REASON
               END-IF
           END-IF.

      * The entry is authentic; its decision record must be too: the
      * next record of its type, whole, against the record MAC.
       3300-CHECK-RECORD.
           SET WS-RECORD-MISSING TO TRUE
           IF LG-ACCEPTED
               PERFORM 3400-READ-ACCEPTED
           ELSE
               PERFORM 3500-READ-REJECTED
           END-IF
           IF WS-RECORD-MISSING
               MOVE "RECORD-MISMATCH" TO WS-REASON
           ELSE
               PERFORM ALZ-RECORD-MAC
               IF NOT ALZ-OK
                   PERFORM 8000-KERNEL-FAILED
               ELSE
                   MOVE 64 TO ALZ-MSG-LEN
                   CALL "alz_ct_equal" USING ALZ-REC-MAC
                                             LG-RECORD-MAC
                                             ALZ-MSG-LEN
                                   RETURNING ALZ-RC
                   IF NOT ALZ-OK
                       MOVE "RECORD-MISMATCH" TO WS-REASON
                   END-IF
               END-IF
           END-IF.

       3400-READ-ACCEPTED.
           IF WS-OK-OPEN
               MOVE LOW-VALUES TO TXN-OK-REC
               READ TXN-OK
               EVALUATE WS-FS-OK
                   WHEN "00"
                   WHEN "04"
                   WHEN "06"
                       IF TA-EOL = X"0A"
                           MOVE TA-DATA TO ALZ-REC-DATA
                           MOVE 206 TO ALZ-REC-LEN
                           SET WS-RECORD-FOUND TO TRUE
                       END-IF
                   WHEN "10"
                       CONTINUE
                   WHEN OTHER
                       DISPLAY "LEDGERCK: read error on ACCEPTED.DAT,"
                           " status " WS-FS-OK UPON SYSERR
                       MOVE 16 TO WS-RETURN-CODE
                       SET WS-EOF TO TRUE
               END-EVALUATE
           END-IF.

       3500-READ-REJECTED.
           IF WS-REJ-OPEN
               MOVE LOW-VALUES TO TXN-REJ-REC
               READ TXN-REJ
               EVALUATE WS-FS-REJ
                   WHEN "00"
                   WHEN "04"
                   WHEN "06"
                       IF TR-EOL = X"0A"
                           MOVE TR-DATA TO ALZ-REC-DATA
                           MOVE 64 TO ALZ-REC-LEN
                           SET WS-RECORD-FOUND TO TRUE
                       END-IF
                   WHEN "10"
                       CONTINUE
                   WHEN OTHER
                       DISPLAY "LEDGERCK: read error on REJECTED.DAT,"
                           " status " WS-FS-REJ UPON SYSERR
                       MOVE 16 TO WS-RETURN-CODE
                       SET WS-EOF TO TRUE
               END-EVALUATE
           END-IF.

      * After the last entry both record files must be exhausted: a
      * record that no entry seals was added after the fact.
       4000-CHECK-LEFTOVERS.
           IF WS-OK-OPEN
               READ TXN-OK
               IF WS-FS-OK NOT = "10"
                   MOVE "RECORD-MISMATCH" TO WS-REASON
               END-IF
           END-IF
           IF WS-REJ-OPEN AND WS-CHAIN-INTACT
               READ TXN-REJ
               IF WS-FS-REJ NOT = "10"
                   MOVE "RECORD-MISMATCH" TO WS-REASON
               END-IF
           END-IF.

       8000-KERNEL-FAILED.
           DISPLAY "LEDGERCK: MAC computation failed" UPON SYSERR
           MOVE 12 TO WS-RETURN-CODE
           MOVE "KERNEL" TO WS-REASON.

       9000-REPORT.
           MOVE SPACES TO WS-RESULT
           IF WS-RETURN-CODE = 0
               STRING "ALZ-LEDGER|STATUS=OK|ENTRIES=" WS-VERIFIED
                      "|HEAD=" WS-PREV-MAC
                   DELIMITED BY SIZE INTO WS-RESULT
           ELSE
               STRING "ALZ-LEDGER|STATUS=BROKEN|ENTRIES=" WS-VERIFIED
                      "|SEQ=" WS-EXPECTED-SEQ
                      "|REASON=" WS-REASON
                   DELIMITED BY SIZE INTO WS-RESULT
           END-IF
           DISPLAY FUNCTION TRIM(WS-RESULT TRAILING).

       COPY ALZKEYP.
       END PROGRAM LEDGERCK.
