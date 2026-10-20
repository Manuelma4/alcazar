      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZKEYP - procedure paragraphs for key handling, shared by
      *           TXNGUARD and LEDGERCK.
      *
      * The including program must COPY ALZCAPI and ALZKEYW, and
      * declare in SPECIAL-NAMES:
      *   CLASS ALZ-JOB-CHAR IS "abcdefghijklmnopqrstuvwxyz"
      *                         "0123456789" "-"
      *   CLASS ALZ-HEX      IS "0123456789abcdef"
      *
      * SET ALZ-NEEDS-TOKEN-KEY TO TRUE if the program needs K-token,
      * PERFORM ALZ-PREPARE-KEYS, then test ALZ-KEYS-READY. Every
      * failure is reported on SYSERR and leaves ALZ-KEYS-FAILED set.
      * PERFORM ALZ-WIPE-KEYS before ending.
      *----------------------------------------------------------------
       ALZ-PREPARE-KEYS.
           SET ALZ-KEYS-FAILED TO TRUE
      *    Power-on self-test: never seal or verify with a kernel that
      *    fails its known-answer tests.
           CALL "alz_selftest" RETURNING ALZ-RC
           IF NOT ALZ-OK
               DISPLAY ALZ-PROGRAM-NAME ": crypto self-test failed"
                   UPON SYSERR
           ELSE
               PERFORM ALZ-READ-JOB-ID
               IF ALZ-JOB-LEN > 0
                   PERFORM ALZ-READ-KEYS
                   IF ALZ-OK
                       PERFORM ALZ-DERIVE-GENESIS
                       IF ALZ-OK
                           SET ALZ-KEYS-READY TO TRUE
                       END-IF
                   END-IF
               END-IF
           END-IF.

      * Job id: the single command-line argument, 1-32 characters from
      * a-z 0-9 -. It binds the ledger to this job (genesis MAC).
       ALZ-READ-JOB-ID.
           MOVE SPACES TO ALZ-JOB-ARG
           ACCEPT ALZ-JOB-ARG FROM COMMAND-LINE
           MOVE 0 TO ALZ-JOB-LEN
           INSPECT ALZ-JOB-ARG TALLYING ALZ-JOB-LEN
               FOR CHARACTERS BEFORE INITIAL SPACE
           IF ALZ-JOB-LEN < 1 OR ALZ-JOB-LEN > 32
               MOVE 0 TO ALZ-JOB-LEN
           ELSE
               IF ALZ-JOB-ARG(1:ALZ-JOB-LEN) IS NOT ALZ-JOB-CHAR
                  OR ALZ-JOB-ARG(ALZ-JOB-LEN + 1:) NOT = SPACES
                   MOVE 0 TO ALZ-JOB-LEN
               END-IF
           END-IF
           IF ALZ-JOB-LEN = 0
               DISPLAY ALZ-PROGRAM-NAME ": expected one job id"
                   " argument (a-z 0-9 -, at most 32)" UPON SYSERR
           ELSE
               MOVE ALZ-JOB-ARG(1:ALZ-JOB-LEN) TO ALZ-JOB-ID
           END-IF.

      * Sub-keys on stdin, one line of 64 lower-case hex digits each -
      * never on the command line (visible in ps) nor in the
      * environment: K-ledger, then K-token if the program needs it.
      * Gatehouse derives them, K = HMAC-SHA256(master, label || X"01"),
      * so a legacy process never holds the master key, and LEDGERCK
      * cannot compute (or reverse) the pseudonymous tokens.
       ALZ-READ-KEYS.
           PERFORM ALZ-READ-KEY-LINE
           IF ALZ-OK
               MOVE ALZ-KEY-BIN TO ALZ-LEDGER-KEY
               IF ALZ-NEEDS-TOKEN-KEY
                   PERFORM ALZ-READ-KEY-LINE
                   IF ALZ-OK
                       MOVE ALZ-KEY-BIN TO ALZ-TOKEN-KEY
                   END-IF
               END-IF
           END-IF
           MOVE 32 TO ALZ-KEY-LEN
           CALL "alz_zeroize" USING ALZ-KEY-BIN ALZ-KEY-LEN
                          RETURNING ALZ-WIPE-RC
           IF NOT ALZ-OK
               DISPLAY ALZ-PROGRAM-NAME ": stdin must carry each key"
                   " as 64 lower-case hex digits on its own line"
                   UPON SYSERR
           ELSE
               PERFORM ALZ-CHECK-STDIN-DRAINED
               IF ALZ-OK AND ALZ-NEEDS-TOKEN-KEY
                   PERFORM ALZ-CHECK-SEPARATION
               END-IF
           END-IF.

      * Not ACCEPT: it reads through stdio and the COBOL run time,
      * whose buffers keep the hex text after ALZ-KEY-HEX is wiped.
      * alz_read_line reads with read(2), byte by byte, into
      * ALZ-KEY-HEX only.
       ALZ-READ-KEY-LINE.
           MOVE SPACES TO ALZ-KEY-HEX
           MOVE 80 TO ALZ-OUT-CAP
           CALL "alz_read_line" USING ALZ-KEY-HEX ALZ-OUT-CAP
                                      ALZ-OUT-LEN
                            RETURNING ALZ-RC
           IF ALZ-OK
               IF ALZ-OUT-LEN = 64 AND ALZ-KEY-HEX(1:64) IS ALZ-HEX
                   MOVE 64 TO ALZ-HEX-LEN
                   MOVE 32 TO ALZ-OUT-CAP
                   CALL "alz_hex_decode" USING ALZ-KEY-HEX ALZ-HEX-LEN
                                               ALZ-KEY-BIN ALZ-OUT-CAP
                                               ALZ-OUT-LEN
                                     RETURNING ALZ-RC
                   IF ALZ-OK AND ALZ-OUT-LEN NOT = 32
                       MOVE -1 TO ALZ-RC
                   END-IF
               ELSE
                   MOVE -1 TO ALZ-RC
               END-IF
           END-IF
           MOVE 80 TO ALZ-MSG-LEN
           CALL "alz_zeroize" USING ALZ-KEY-HEX ALZ-MSG-LEN
                          RETURNING ALZ-WIPE-RC.

      * A program given more than its keys - LEDGERCK handed K-token
      * too - refuses to run: least privilege on the receiving side.
       ALZ-CHECK-STDIN-DRAINED.
           CALL "alz_expect_eof" RETURNING ALZ-RC
           IF NOT ALZ-OK
               DISPLAY ALZ-PROGRAM-NAME ": stdin carries more than"
                   " the keys this program may hold" UPON SYSERR
           END-IF.

      * The same key twice means the sender skipped the derivation:
      * tokens would then be MACs under the ledger key.
       ALZ-CHECK-SEPARATION.
           MOVE 32 TO ALZ-MSG-LEN
           CALL "alz_ct_equal" USING ALZ-LEDGER-KEY ALZ-TOKEN-KEY
                                     ALZ-MSG-LEN
                           RETURNING ALZ-RC
           IF ALZ-OK
               MOVE -1 TO ALZ-RC
               DISPLAY ALZ-PROGRAM-NAME ": K-ledger and K-token must"
                   " differ" UPON SYSERR
           ELSE
               MOVE 0 TO ALZ-RC
           END-IF.

      * Genesis MAC for this job (ledger format v2):
      *   HMAC-SHA256(K-ledger, "alcazar/genesis/v2|" || job id).
       ALZ-DERIVE-GENESIS.
           MOVE SPACES TO ALZ-KDF-INFO
           MOVE 1 TO ALZ-KDF-LEN
           STRING "alcazar/genesis/v2|" ALZ-JOB-ID(1:ALZ-JOB-LEN)
               DELIMITED BY SIZE
               INTO ALZ-KDF-INFO WITH POINTER ALZ-KDF-LEN
           SUBTRACT 1 FROM ALZ-KDF-LEN
           MOVE 32 TO ALZ-KEY-LEN
           CALL "alz_hmac_sha256_hex" USING ALZ-LEDGER-KEY ALZ-KEY-LEN
                                            ALZ-KDF-INFO ALZ-KDF-LEN
                                            ALZ-GENESIS
                                  RETURNING ALZ-RC
           IF NOT ALZ-OK
               DISPLAY ALZ-PROGRAM-NAME ": genesis MAC failed"
                   UPON SYSERR
           END-IF.

      * Record MAC: binds an ACCEPTED or REJECTED record to its
      * ledger entry. Set ALZ-REC-DATA and ALZ-REC-LEN first.
       ALZ-RECORD-MAC.
           ADD 15 TO ALZ-REC-LEN GIVING ALZ-MSG-LEN
           MOVE 32 TO ALZ-KEY-LEN
           CALL "alz_hmac_sha256_hex" USING ALZ-LEDGER-KEY ALZ-KEY-LEN
                                            ALZ-REC-INPUT ALZ-MSG-LEN
                                            ALZ-REC-MAC
                                  RETURNING ALZ-RC.

       ALZ-WIPE-KEYS.
           MOVE 32 TO ALZ-KEY-LEN
           CALL "alz_zeroize" USING ALZ-LEDGER-KEY ALZ-KEY-LEN
                          RETURNING ALZ-WIPE-RC
           CALL "alz_zeroize" USING ALZ-TOKEN-KEY ALZ-KEY-LEN
                          RETURNING ALZ-WIPE-RC.
