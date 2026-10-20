      *================================================================
      * TROJAN SOURCE SAMPLE - INTENTIONALLY MALICIOUS - DO NOT COMPILE
      *
      * Demo material for Watchtower, rules ALZ-GEN-001 and ALZ-GEN-002.
      * This file contains real Unicode bidirectional controls
      * (CVE-2021-42574), a zero-width space and a Cyrillic homoglyph.
      * Editors and review tools display it differently from what the
      * compiler reads: inspect it with a hex viewer (xxd, od -c).
      * It is the only file of the repository allowed to contain them.
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. TROJANSRC.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ROLE                 PIC X(10) VALUE "USER".
       01  WS-XFER-AMT             PIC 9(7)V99 VALUE 0.
       01  WS-LIMIT                PIC 9(7)V99 VALUE 500.00.
       01  WS-LІMIT                PIC 9(7)V99 VALUE 9999999.99.
       01  WS-APPROVED             PIC X VALUE "N".
       PROCEDURE DIVISION.
       0000-MAIN.
      *    Only administrators approve.‮⁦ batch users too⁩‬
           IF WS-ROLE = "ADMIN‮⁦ *> or any user ⁩⁦"
               MOVE "Y" TO WS-APP​ROVED
           END-IF
      *    Transfers above the 500.00 limit are never auto-approved.
           IF WS-XFER-AMT <= WS-LІMIT
               MOVE "Y" TO WS-APPROVED
           END-IF
           STOP RUN.
