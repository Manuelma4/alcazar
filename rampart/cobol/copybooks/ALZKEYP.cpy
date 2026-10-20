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
                   PERFORM ALZ-READ-KEY
                   IF ALZ-OK
                       PERFORM ALZ-DERIVE-KEYS
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

      * Master key: 64 lower-case hex digits on stdin - never on the
      * command line (visible in ps) nor in the environment.
       ALZ-READ-KEY.
           MOVE -1 TO ALZ-RC
           MOVE SPACES TO ALZ-KEY-HEX
           ACCEPT ALZ-KEY-HEX
           IF ALZ-KEY-HEX(1:64) IS ALZ-HEX
              AND ALZ-KEY-HEX(65:16) = SPACES
               MOVE 64 TO ALZ-HEX-LEN
               MOVE 32 TO ALZ-OUT-CAP
               CALL "alz_hex_decode" USING ALZ-KEY-HEX ALZ-HEX-LEN
                                           ALZ-MASTER-KEY ALZ-OUT-CAP
                                           ALZ-OUT-LEN
                                 RETURNING ALZ-RC
               IF ALZ-OK AND ALZ-OUT-LEN NOT = 32
                   MOVE -1 TO ALZ-RC
               END-IF
           END-IF
           IF NOT ALZ-OK
               DISPLAY ALZ-PROGRAM-NAME ": stdin must carry the key"
                   " as 64 lower-case hex digits" UPON SYSERR
           END-IF
           MOVE 80 TO ALZ-MSG-LEN
           CALL "alz_zeroize" USING ALZ-KEY-HEX ALZ-MSG-LEN
                          RETURNING ALZ-WIPE-RC.

      * Key separation: one sub-key per purpose,
      *   K = HMAC-SHA256(master, label || X"01"),
      * then the master key is wiped. Genesis MAC for this job:
      *   HMAC-SHA256(K-ledger, "alcazar/genesis|" || job id).
       ALZ-DERIVE-KEYS.
           MOVE SPACES TO ALZ-KDF-INFO
           MOVE 1 TO ALZ-KDF-LEN
           STRING "alcazar/ledger/v1" X"01" DELIMITED BY SIZE
               INTO ALZ-KDF-INFO WITH POINTER ALZ-KDF-LEN
           SUBTRACT 1 FROM ALZ-KDF-LEN
           MOVE 32 TO ALZ-KEY-LEN
           CALL "alz_hmac_sha256" USING ALZ-MASTER-KEY ALZ-KEY-LEN
                                        ALZ-KDF-INFO ALZ-KDF-LEN
                                        ALZ-LEDGER-KEY
                              RETURNING ALZ-RC
           IF ALZ-OK
               MOVE SPACES TO ALZ-KDF-INFO
               MOVE 1 TO ALZ-KDF-LEN
               STRING "alcazar/token/v1" X"01" DELIMITED BY SIZE
                   INTO ALZ-KDF-INFO WITH POINTER ALZ-KDF-LEN
               SUBTRACT 1 FROM ALZ-KDF-LEN
               CALL "alz_hmac_sha256" USING ALZ-MASTER-KEY
                                            ALZ-KEY-LEN
                                            ALZ-KDF-INFO ALZ-KDF-LEN
                                            ALZ-TOKEN-KEY
                                  RETURNING ALZ-RC
           END-IF
           IF ALZ-OK
               MOVE SPACES TO ALZ-KDF-INFO
               MOVE 1 TO ALZ-KDF-LEN
               STRING "alcazar/genesis|" ALZ-JOB-ID(1:ALZ-JOB-LEN)
                   DELIMITED BY SIZE
                   INTO ALZ-KDF-INFO WITH POINTER ALZ-KDF-LEN
               SUBTRACT 1 FROM ALZ-KDF-LEN
               CALL "alz_hmac_sha256_hex" USING ALZ-LEDGER-KEY
                                                ALZ-KEY-LEN
                                                ALZ-KDF-INFO
                                                ALZ-KDF-LEN
                                                ALZ-GENESIS
                                      RETURNING ALZ-RC
           END-IF
           CALL "alz_zeroize" USING ALZ-MASTER-KEY ALZ-KEY-LEN
                          RETURNING ALZ-WIPE-RC
           IF NOT ALZ-OK
               DISPLAY ALZ-PROGRAM-NAME ": key derivation failed"
                   UPON SYSERR
           END-IF.

       ALZ-WIPE-KEYS.
           MOVE 32 TO ALZ-KEY-LEN
           CALL "alz_zeroize" USING ALZ-LEDGER-KEY ALZ-KEY-LEN
                          RETURNING ALZ-WIPE-RC
           CALL "alz_zeroize" USING ALZ-TOKEN-KEY ALZ-KEY-LEN
                          RETURNING ALZ-WIPE-RC
           CALL "alz_zeroize" USING ALZ-MASTER-KEY ALZ-KEY-LEN
                          RETURNING ALZ-WIPE-RC.
