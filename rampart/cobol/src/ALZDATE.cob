      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZDATE.
      *----------------------------------------------------------------
      * ALZDATE - validate a YYYYMMDDHHMMSS timestamp.
      *
      *   CALL "ALZDATE" USING timestamp rc
      *
      *   timestamp  PIC X(14)
      *   rc         0 ok, 1 not 14 digits, 2 no such calendar date,
      *              3 no such time of day
      *
      * The digits are checked with a class test before any numeric
      * field is touched, so bad data can never reach arithmetic.
      *----------------------------------------------------------------
       DATA DIVISION.
       LINKAGE SECTION.
       01  LK-TS.
           05  LK-DATE                 PIC 9(8).
           05  LK-HOUR                 PIC 99.
           05  LK-MINUTE               PIC 99.
           05  LK-SECOND               PIC 99.
       01  LK-RC                       PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-TS LK-RC.
       0000-MAIN.
           MOVE 0 TO LK-RC
           IF LK-TS IS NOT NUMERIC
               MOVE 1 TO LK-RC
               GOBACK
           END-IF
           IF FUNCTION TEST-DATE-YYYYMMDD(LK-DATE) NOT = 0
               MOVE 2 TO LK-RC
               GOBACK
           END-IF
           IF LK-HOUR > 23 OR LK-MINUTE > 59 OR LK-SECOND > 59
               MOVE 3 TO LK-RC
           END-IF
           GOBACK.
       END PROGRAM ALZDATE.
