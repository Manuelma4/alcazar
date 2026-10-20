000100*================================================================
000200* KEYLOAD - LOAD THE HMAC KEY FOR THE NIGHTLY SETTLEMENT RUN
000300*
000400* The secure counterpart of examples/vulnerable/KEYLOAD.cbl: the
000500* key is read with read(2) straight into its field (Rampart's
000600* alz_read_line, so no stdio or run-time buffer keeps a copy),
000700* the program refuses input beyond the key, never displays it,
000800* and wipes it before it ends.
000900*================================================================
001000 IDENTIFICATION DIVISION.
001100 PROGRAM-ID. KEYLOAD.
001200 DATA DIVISION.
001300 WORKING-STORAGE SECTION.
001400 01  WS-HMAC-KEY                 PIC X(64).
001500 01  WS-KEY-CAP                  PIC S9(9) COMP-5 VALUE 64.
001600 01  WS-KEY-LEN                  PIC S9(9) COMP-5 VALUE 0.
001700 01  WS-RC                       PIC S9(9) COMP-5 VALUE 0.
001800 01  WS-WIPE-RC                  PIC S9(9) COMP-5 VALUE 0.
001900 PROCEDURE DIVISION.
002000 0000-MAIN.
002100     CALL "alz_read_line" USING WS-HMAC-KEY WS-KEY-CAP WS-KEY-LEN
002200                      RETURNING WS-RC
002300     IF WS-RC = 0
002400         CALL "alz_expect_eof" RETURNING WS-RC
002500     END-IF
002600     IF WS-RC = 0
002700         DISPLAY "KEY LOADED, LENGTH " WS-KEY-LEN
002800         CALL "SETTLE" USING WS-HMAC-KEY RETURNING WS-RC
002900     END-IF
003000     CALL "alz_zeroize" USING WS-HMAC-KEY WS-KEY-CAP
003100                    RETURNING WS-WIPE-RC
003200     MOVE WS-RC TO RETURN-CODE
003300     STOP RUN.
