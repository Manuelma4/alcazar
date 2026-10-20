000100*================================================================
000200* KEYLOAD - LOAD THE HMAC KEY FOR THE NIGHTLY SETTLEMENT RUN
000300*
000400* !!! INTENTIONALLY VULNERABLE - DO NOT USE IN PRODUCTION !!!
000500* Demo material for Watchtower, the Alcazar static analyzer.
000600* Every flaw in this program is deliberate; the fixed version is
000700* examples/hardened/KEYLOAD.cbl.
000800*
000900* Planted flaws: the key is read with ACCEPT, so stdio and the
001000* COBOL run time keep copies of it; it is echoed to SYSOUT; and
001100* it is never wiped.
001200*================================================================
001300 IDENTIFICATION DIVISION.
001400 PROGRAM-ID. KEYLOAD.
001500 DATA DIVISION.
001600 WORKING-STORAGE SECTION.
001700 01  WS-HMAC-KEY                 PIC X(64).
001800 01  WS-RC                       PIC S9(9) COMP-5.
001900 PROCEDURE DIVISION.
002000 0000-MAIN.
002100     ACCEPT WS-HMAC-KEY
002200     DISPLAY "KEY LOADED: " WS-HMAC-KEY
002300     CALL "SETTLE" USING WS-HMAC-KEY RETURNING WS-RC
002400     MOVE WS-RC TO RETURN-CODE
002500     STOP RUN.
