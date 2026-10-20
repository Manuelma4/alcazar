      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEDGERCK.
      *================================================================
      * LEDGERCK - verify the HMAC chain of the audit ledger (Seal).
      *
      *   stdin   the 256-bit master key, 64 lower-case hex digits
      *   args    the job id the ledger was sealed for
      *   in      LEDGER.DAT
      *   stdout  exactly one line:
      *     ALZ-LEDGER|STATUS=OK|ENTRIES=000004|HEAD=<64 hex>
      *     ALZ-LEDGER|STATUS=BROKEN|ENTRIES=000001|SEQ=000002|
      *       REASON=MAC-MISMATCH        (on a single line)
      *
      *   Return codes   0 chain valid       4 chain broken
      *                 12 key or self-test error
      *                 16 I/O error
      *
      * Each entry is checked in order: format (FORMAT), sequence
      * number (SEQ-GAP), link to the previous MAC (CHAIN-BREAK), and
      * the MAC itself, compared in constant time (MAC-MISMATCH).
      * ENTRIES counts the entries verified before the first failure.
      *
      * A valid chain proves no entry was edited, removed or
      * reordered. Removing entries from the END leaves a valid,
      * shorter chain: only the anchored head kept by Gatehouse
      * reveals truncation (docs/THREAT_MODEL.md).
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
                           ORGANIZATION IS LINE SEQUENTIAL
                           FILE STATUS IS WS-FS-LEDGER.
       DATA DIVISION.
       FILE SECTION.
       FD  LEDGER.
       01  LEDGER-RECORD               PIC X(246).

       WORKING-STORAGE SECTION.
       COPY ALZCAPI.
       COPY ALZKEYW.
       COPY ALZLEDG.
       01  WS-FS-LEDGER                PIC XX.
       01  WS-EOF-SW                   PIC X VALUE "N".
           88  WS-EOF                  VALUE "Y".
       01  WS-RETURN-CODE              PIC 99 VALUE 0.
       01  WS-VERIFIED                 PIC 9(6) VALUE 0.
       01  WS-EXPECTED-SEQ             PIC 9(6) VALUE 1.
       01  WS-PREV-MAC                 PIC X(64).
       01  WS-COMPUTED-MAC             PIC X(64).
       01  WS-REASON                   PIC X(12) VALUE SPACES.
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

       1000-VERIFY-LEDGER.
           OPEN INPUT LEDGER
           IF WS-FS-LEDGER NOT = "00"
               DISPLAY "LEDGERCK: cannot open LEDGER.DAT, status "
                   WS-FS-LEDGER UPON SYSERR
               MOVE 16 TO WS-RETURN-CODE
           ELSE
               PERFORM 2000-NEXT-ENTRY
                   UNTIL WS-EOF OR NOT WS-CHAIN-INTACT
               CLOSE LEDGER
               IF NOT WS-CHAIN-INTACT
                   MOVE 4 TO WS-RETURN-CODE
               END-IF
           END-IF.

       2000-NEXT-ENTRY.
           MOVE SPACES TO LEDGER-RECORD
           READ LEDGER
           EVALUATE WS-FS-LEDGER
               WHEN "00"
                   MOVE LEDGER-RECORD TO LEDGER-LINE
                   PERFORM 3000-CHECK-ENTRY
               WHEN "10"
                   SET WS-EOF TO TRUE
      *        04/06: line too long (an extra field or record was
      *        appended); 09: control characters in the line.
               WHEN "04"
               WHEN "06"
               WHEN "09"
                   MOVE "FORMAT" TO WS-REASON
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
                   END-IF
               END-IF
           END-IF
           IF WS-CHAIN-INTACT
               MOVE LG-MAC TO WS-PREV-MAC
               ADD 1 TO WS-VERIFIED
               ADD 1 TO WS-EXPECTED-SEQ
           END-IF.

      * Every separator in place, numeric fields numeric, and both
      * MACs exactly 64 lower-case hex digits (a short line leaves
      * spaces there and fails the class test).
       3100-CHECK-FORMAT.
           IF LG-SEP-1 NOT = "|" OR LG-SEP-2 NOT = "|"
              OR LG-SEP-3 NOT = "|" OR LG-SEP-4 NOT = "|"
              OR LG-SEP-5 NOT = "|" OR LG-SEP-6 NOT = "|"
              OR LG-SEP-7 NOT = "|" OR LG-SEP-8 NOT = "|"
              OR LG-SEP-9 NOT = "|" OR LG-SEP-10 NOT = "|"
              OR LG-SEQ IS NOT NUMERIC
              OR LG-AMOUNT-CENTS IS NOT NUMERIC
              OR NOT (LG-ACCEPTED OR LG-REJECTED)
              OR LG-PREV-MAC IS NOT ALZ-HEX
              OR LG-MAC IS NOT ALZ-HEX
               MOVE "FORMAT" TO WS-REASON
           END-IF.

       3200-CHECK-MAC.
           MOVE 32 TO ALZ-KEY-LEN
           MOVE 181 TO ALZ-MSG-LEN
           CALL "alz_hmac_sha256_hex" USING ALZ-LEDGER-KEY ALZ-KEY-LEN
                                            LG-MAC-INPUT ALZ-MSG-LEN
                                            WS-COMPUTED-MAC
                                  RETURNING ALZ-RC
           IF NOT ALZ-OK
               DISPLAY "LEDGERCK: MAC computation failed" UPON SYSERR
               MOVE 12 TO WS-RETURN-CODE
               MOVE "KERNEL" TO WS-REASON
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
