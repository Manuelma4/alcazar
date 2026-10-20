      * SPDX-License-Identifier: Apache-2.0
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALZPANSC.
      *----------------------------------------------------------------
      * ALZPANSC - look for a payment card number in free text, so a
      *            full PAN typed into a memo never leaves the core
      *            (PCI DSS: only BIN + last 4 may be displayed).
      *
      *   CALL "ALZPANSC" USING text rc position
      *
      *   text      PIC X ANY LENGTH (the first 1024 characters)
      *   rc        0 none found, 1 card number found
      *   position  1-based offset of its first digit
      *
      * People write card numbers in groups - "4111 1111 1111 1111",
      * "4111-1111-...", "4111.1111-..." - often next to an expiry
      * date or a CVV, sometimes glued to a word. So:
      *   1. Every valid IBAN in the text (two letters of either case
      *      starting a word, check digits, BBAN; single spaces allowed;
      *      confirmed by ALZIBAN) is set aside: its digits are not a
      *      card, whatever they look like.
      *   2. Digit groups joined by one or two spaces, hyphens, dots or
      *      slashes form a chain.
      *   3. Inside a chain only groups of 3 or more digits link up,
      *      except that the chain's last group may be shorter (Diners
      *      4-4-4-2, Visa 4-4-4-1): dates, phone numbers and amounts,
      *      written in groups of two, never join a card number.
      *   4. Every stretch from a group start to a group end that has
      *      16 or 19 digits starting with 2-6 - or 13, 14, 15, 17 or 18
      *      digits with a card network's prefix that issues that length
      *      (Visa 4: 13, Amex 34/37: 15, Diners: 14...) - and a valid
      *      Luhn check digit is a card number.
      * Known limit: a card number glued to more digits with no
      * separator at all ("41111111111111111234") is one group, and
      * is not found.
      *----------------------------------------------------------------
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SPECIAL-NAMES.
           CLASS ALZ-DIGIT  IS "0123456789"
           CLASS ALZ-LETTER IS "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                               "abcdefghijklmnopqrstuvwxyz"
           CLASS ALZ-JOINER IS " -./".
       DATA DIVISION.
       WORKING-STORAGE SECTION.
      * Card networks, read-only: prefix digits (1-4), prefix range,
      * and the lengths issued, 13 to 19 ("1" = issued).
       01  WS-NETWORK-DATA.
      *    Visa
           05  FILLER PIC X(16) VALUE "1000400041001001".
      *    Mastercard
           05  FILLER PIC X(16) VALUE "2005100550001000".
      *    Mastercard 2-series
           05  FILLER PIC X(16) VALUE "4222127200001000".
      *    American Express
           05  FILLER PIC X(16) VALUE "2003400340010000".
      *    American Express
           05  FILLER PIC X(16) VALUE "2003700370010000".
      *    Diners Club
           05  FILLER PIC X(16) VALUE "3030003050111111".
      *    Diners Club
           05  FILLER PIC X(16) VALUE "2003600360111111".
      *    Diners Club / Discover
           05  FILLER PIC X(16) VALUE "2003800390001111".
      *    Discover
           05  FILLER PIC X(16) VALUE "4601160110001111".
      *    Discover
           05  FILLER PIC X(16) VALUE "3064406490001111".
      *    Discover
           05  FILLER PIC X(16) VALUE "2006500650001111".
      *    JCB
           05  FILLER PIC X(16) VALUE "4352835890001111".
      *    UnionPay
           05  FILLER PIC X(16) VALUE "2006200620001111".
      *    Mir
           05  FILLER PIC X(16) VALUE "4220022040001111".
      *    RuPay
           05  FILLER PIC X(16) VALUE "2006000600001111".
      *    Diners Club (3095), Bancontact, Dankort, BORICA
           05  FILLER PIC X(16) VALUE "4309530950111111".
           05  FILLER PIC X(16) VALUE "4670367030001111".
           05  FILLER PIC X(16) VALUE "4501950190001000".
           05  FILLER PIC X(16) VALUE "4220522050001000".
      *    Maestro
           05  FILLER PIC X(16) VALUE "4501850181111111".
      *    Maestro
           05  FILLER PIC X(16) VALUE "4502050201111111".
      *    Maestro
           05  FILLER PIC X(16) VALUE "4503850381111111".
      *    Maestro
           05  FILLER PIC X(16) VALUE "4589358931111111".
      *    Maestro
           05  FILLER PIC X(16) VALUE "4630463041111111".
      *    Maestro
           05  FILLER PIC X(16) VALUE "4675967591111111".
      *    Maestro
           05  FILLER PIC X(16) VALUE "4676167631111111".
       01  WS-NETWORKS REDEFINES WS-NETWORK-DATA.
           05  WS-NET                  OCCURS 26 TIMES.
               10  WS-NET-DIGITS       PIC 9.
               10  WS-NET-LOW          PIC 9(4).
               10  WS-NET-HIGH         PIC 9(4).
               10  WS-NET-LENGTHS      PIC X(7).
       LOCAL-STORAGE SECTION.
       01  LS-LEN                      PIC S9(9) COMP-5.
       01  LS-I                        PIC S9(9) COMP-5.
       01  LS-P                        PIC S9(9) COMP-5.
       01  LS-Q                        PIC S9(9) COMP-5.
       01  LS-CH                       PIC X.
       01  LS-NEXT                     PIC X.
       01  LS-JN                       PIC S9(9) COMP-5.
       01  LS-JOINS-SW                 PIC X.
           88  LS-JOINS                VALUE "Y".
       01  LS-JOINER-LEN               PIC S9(9) COMP-5.
       01  LS-JOINER-TXT               PIC X(3) VALUE SPACES.
       01  LS-GAP-SW                   PIC X.
           88  LS-GAP                  VALUE "Y".
           88  LS-NO-GAP               VALUE "N".
       01  LS-FULL-SW                  PIC X VALUE "N".
           88  LS-FULL                 VALUE "Y".
      * IBANs: the positions set aside, and the candidate being tried.
       01  LS-EXCLUDED                 PIC X(1024).
       01  LS-WORD-START               PIC X.
       01  LS-CAND                     PIC X(34).
       01  LS-CAND-LEN                 PIC S9(9) COMP-5.
       01  LS-CAND-POSITIONS.
           05  LS-CAND-POS             PIC S9(9) COMP-5 OCCURS 34 TIMES.
       01  LS-L                        PIC S9(9) COMP-5.
       01  LS-IBAN                     PIC X(34).
       01  LS-IBAN-RC                  PIC S9(9) COMP-5.
       01  LS-IBAN-SW                  PIC X.
           88  LS-IBAN-FOUND           VALUE "Y".
      * Digit groups: where each is in the text and in LS-DIGITS, how
      * long it is, and whether a joiner links it to the one before.
       01  LS-DIGITS                   PIC X(1024).
       01  LS-NDIG                     PIC S9(9) COMP-5.
       01  LS-NGROUP                   PIC S9(9) COMP-5.
       01  LS-GROUPS.
           05  LS-GROUP                OCCURS 512 TIMES.
               10  LS-G-POS            PIC S9(9) COMP-5.
               10  LS-G-START          PIC S9(9) COMP-5.
               10  LS-G-LEN            PIC S9(9) COMP-5.
               10  LS-G-JOINED         PIC X.
       01  LS-A                        PIC S9(9) COMP-5.
       01  LS-Z                        PIC S9(9) COMP-5.
       01  LS-C                        PIC S9(9) COMP-5.
       01  LS-B                        PIC S9(9) COMP-5.
       01  LS-GI                       PIC S9(9) COMP-5.
       01  LS-GJ                       PIC S9(9) COMP-5.
       01  LS-WIN-START                PIC S9(9) COMP-5.
       01  LS-WIN-LEN                  PIC S9(9) COMP-5.
       01  LS-WINDOW                   PIC X(19).
       01  LS-K                        PIC S9(9) COMP-5.
       01  LS-D                        PIC S9(9) COMP-5.
       01  LS-PREFIX                   PIC 9(4).
       01  LS-DIGIT-X                  PIC X.
       01  LS-DIGIT REDEFINES LS-DIGIT-X PIC 9.
       01  LS-NETWORK-SW               PIC X.
           88  LS-NETWORK-OK           VALUE "Y".
       01  LS-LUHN-RC                  PIC S9(9) COMP-5.
       01  LS-WIPE-LEN                 PIC S9(9) COMP-5.
       01  LS-WIPE-RC                  PIC S9(9) COMP-5.
       LINKAGE SECTION.
       01  LK-TEXT                     PIC X ANY LENGTH.
       01  LK-RC                       PIC S9(9) COMP-5.
       01  LK-POS                      PIC S9(9) COMP-5.

       PROCEDURE DIVISION USING LK-TEXT LK-RC LK-POS.
       0000-MAIN.
           MOVE 0 TO LK-RC
           MOVE 0 TO LK-POS
           MOVE FUNCTION LENGTH(LK-TEXT) TO LS-LEN
           IF LS-LEN > 1024
               MOVE 1024 TO LS-LEN
           END-IF
           PERFORM 1000-SET-ASIDE-IBANS
           PERFORM 2000-COLLECT-GROUPS
           PERFORM 3000-SCAN-CHAINS
           PERFORM 9000-WIPE
           GOBACK.

      *----------------------------------------------------------------
      * Pass 1: valid IBANs are set aside.
      *----------------------------------------------------------------
       1000-SET-ASIDE-IBANS.
           MOVE ALL "N" TO LS-EXCLUDED
           PERFORM VARYING LS-P FROM 1 BY 1 UNTIL LS-P > LS-LEN - 3
               IF LS-EXCLUDED(LS-P:1) = "N"
                   PERFORM 1100-TRY-IBAN-AT
               END-IF
           END-PERFORM.

      * Two letters, then two check digits, at the start of a word.
       1100-TRY-IBAN-AT.
           IF LK-TEXT(LS-P:1) IS ALZ-LETTER
              AND LK-TEXT(LS-P + 1:1) IS ALZ-LETTER
              AND LK-TEXT(LS-P + 2:1) IS ALZ-DIGIT
              AND LK-TEXT(LS-P + 3:1) IS ALZ-DIGIT
               MOVE "Y" TO LS-WORD-START
               IF LS-P > 1
                   IF LK-TEXT(LS-P - 1:1) IS ALZ-LETTER
                      OR LK-TEXT(LS-P - 1:1) IS ALZ-DIGIT
                       MOVE "N" TO LS-WORD-START
                   END-IF
               END-IF
               IF LS-WORD-START = "Y"
                   PERFORM 1200-GATHER-CANDIDATE
                   PERFORM 1300-CONFIRM-CANDIDATE
               END-IF
           END-IF.

      * Up to 34 letters and digits, upper-cased, across the joiners
      * the chains link (1210): an IBAN is set aside however its
      * groups are joined, before its digits could look like a card.
       1200-GATHER-CANDIDATE.
           MOVE SPACES TO LS-CAND
           MOVE 0 TO LS-CAND-LEN
           MOVE LS-P TO LS-Q
           PERFORM UNTIL LS-Q > LS-LEN OR LS-CAND-LEN = 34
               MOVE LK-TEXT(LS-Q:1) TO LS-CH
               IF LS-CH IS ALZ-LETTER OR LS-CH IS ALZ-DIGIT
                   ADD 1 TO LS-CAND-LEN
                   MOVE FUNCTION UPPER-CASE(LS-CH)
                     TO LS-CAND(LS-CAND-LEN:1)
                   MOVE LS-Q TO LS-CAND-POS(LS-CAND-LEN)
                   ADD 1 TO LS-Q
               ELSE
                   PERFORM 1210-JOINER-RUN
                   IF NOT LS-JOINS
                       EXIT PERFORM
                   END-IF
                   ADD LS-JN TO LS-Q
               END-IF
           END-PERFORM.

      * The joiner run at LS-Q (LS-JN characters) joins when the chains
      * would link across it - one or two of " -./", or one of "-./"
      * with a space on each side - and a letter or digit follows.
       1210-JOINER-RUN.
           MOVE "N" TO LS-JOINS-SW
           MOVE 0 TO LS-JN
           PERFORM UNTIL LS-Q + LS-JN > LS-LEN OR LS-JN = 4
               IF LK-TEXT(LS-Q + LS-JN:1) IS NOT ALZ-JOINER
                   EXIT PERFORM
               END-IF
               ADD 1 TO LS-JN
           END-PERFORM
           IF LS-JN > 0 AND LS-JN < 4 AND LS-Q + LS-JN <= LS-LEN
               MOVE LK-TEXT(LS-Q + LS-JN:1) TO LS-NEXT
               IF LS-NEXT IS ALZ-LETTER OR LS-NEXT IS ALZ-DIGIT
                   IF LS-JN <= 2
                       SET LS-JOINS TO TRUE
                   END-IF
      *            Nested, not ANDed: short-circuit evaluation is not
      *            promised (HARDENING.md, item 6), and LS-Q + 2 is only
      *            inside the text when LS-JN is 3.
                   IF LS-JN = 3
                       IF LK-TEXT(LS-Q:1) = SPACE
                          AND LK-TEXT(LS-Q + 2:1) = SPACE
                          AND LK-TEXT(LS-Q + 1:1) NOT = SPACE
                           SET LS-JOINS TO TRUE
                       END-IF
                   END-IF
               END-IF
           END-IF.

      * Only the length of the country's IBANs can pass ALZIBAN.
       1300-CONFIRM-CANDIDATE.
           MOVE "N" TO LS-IBAN-SW
           PERFORM VARYING LS-L FROM 15 BY 1
                   UNTIL LS-L > LS-CAND-LEN OR LS-IBAN-FOUND
               MOVE SPACES TO LS-IBAN
               MOVE LS-CAND(1:LS-L) TO LS-IBAN
               CALL "ALZIBAN" USING LS-IBAN LS-IBAN-RC
               IF LS-IBAN-RC = 0
                   SET LS-IBAN-FOUND TO TRUE
                   PERFORM VARYING LS-Q FROM LS-P BY 1
                           UNTIL LS-Q > LS-CAND-POS(LS-L)
                       MOVE "Y" TO LS-EXCLUDED(LS-Q:1)
                   END-PERFORM
               END-IF
           END-PERFORM.

      *----------------------------------------------------------------
      * Pass 2: the digit groups and the joiners between them.
      *----------------------------------------------------------------
       2000-COLLECT-GROUPS.
           MOVE 0 TO LS-NDIG
           MOVE 0 TO LS-NGROUP
           MOVE 0 TO LS-JOINER-LEN
           SET LS-GAP TO TRUE
           PERFORM VARYING LS-I FROM 1 BY 1
                   UNTIL LS-I > LS-LEN OR LS-FULL
               MOVE LK-TEXT(LS-I:1) TO LS-CH
               EVALUATE TRUE
                   WHEN LS-EXCLUDED(LS-I:1) = "Y"
                       SET LS-GAP TO TRUE
                       MOVE 0 TO LS-JOINER-LEN
                   WHEN LS-CH IS ALZ-DIGIT
                       PERFORM 2100-DIGIT
                   WHEN LS-CH IS ALZ-JOINER
                       ADD 1 TO LS-JOINER-LEN
                       IF LS-JOINER-LEN <= 3
                           MOVE LS-CH TO LS-JOINER-TXT(LS-JOINER-LEN:1)
                       END-IF
                   WHEN OTHER
                       SET LS-GAP TO TRUE
                       MOVE 0 TO LS-JOINER-LEN
               END-EVALUATE
           END-PERFORM.

       2100-DIGIT.
           IF LS-NGROUP > 0 AND LS-NO-GAP AND LS-JOINER-LEN = 0
               ADD 1 TO LS-G-LEN(LS-NGROUP)
           ELSE
               PERFORM 2200-NEW-GROUP
           END-IF
           IF NOT LS-FULL
               ADD 1 TO LS-NDIG
               MOVE LS-CH TO LS-DIGITS(LS-NDIG:1)
               IF LS-NDIG = 1024
                   SET LS-FULL TO TRUE
               END-IF
           END-IF
           SET LS-NO-GAP TO TRUE
           MOVE 0 TO LS-JOINER-LEN.

       2200-NEW-GROUP.
           IF LS-NGROUP = 512
               SET LS-FULL TO TRUE
           ELSE
               ADD 1 TO LS-NGROUP
               MOVE LS-I TO LS-G-POS(LS-NGROUP)
               COMPUTE LS-G-START(LS-NGROUP) = LS-NDIG + 1
               MOVE 1 TO LS-G-LEN(LS-NGROUP)
               MOVE "N" TO LS-G-JOINED(LS-NGROUP)
               IF LS-NGROUP > 1 AND LS-NO-GAP AND LS-JOINER-LEN <= 2
                   MOVE "Y" TO LS-G-JOINED(LS-NGROUP)
               END-IF
      *        "4111 - 1111": one joiner with a space on each side.
               IF LS-NGROUP > 1 AND LS-NO-GAP AND LS-JOINER-LEN = 3
                   IF LS-JOINER-TXT(1:1) = SPACE
                       AND LS-JOINER-TXT(3:1) = SPACE
                       AND LS-JOINER-TXT(2:1) NOT = SPACE
                       MOVE "Y" TO LS-G-JOINED(LS-NGROUP)
                   END-IF
               END-IF
           END-IF.

      *----------------------------------------------------------------
      * Pass 3: chains (groups linked by joiners) A..Z; inside them,
      * strict chains C..B; inside those, the candidate windows.
      *----------------------------------------------------------------
       3000-SCAN-CHAINS.
           MOVE 1 TO LS-A
           PERFORM UNTIL LS-A > LS-NGROUP OR LK-RC NOT = 0
               MOVE LS-A TO LS-Z
               PERFORM UNTIL LS-Z = LS-NGROUP
                   IF LS-G-JOINED(LS-Z + 1) = "N"
                       EXIT PERFORM
                   END-IF
                   ADD 1 TO LS-Z
               END-PERFORM
               PERFORM 3100-STRICT-CHAINS
               COMPUTE LS-A = LS-Z + 1
           END-PERFORM.

      * Groups of 3+ digits link up; the chain's last group may be
      * shorter.
       3100-STRICT-CHAINS.
           MOVE LS-A TO LS-C
           PERFORM UNTIL LS-C > LS-Z OR LK-RC NOT = 0
               MOVE LS-C TO LS-B
               PERFORM UNTIL LS-B = LS-Z
                   IF LS-G-LEN(LS-B) < 3
                       EXIT PERFORM
                   END-IF
                   IF LS-G-LEN(LS-B + 1) < 3 AND LS-B + 1 NOT = LS-Z
                       EXIT PERFORM
                   END-IF
                   ADD 1 TO LS-B
               END-PERFORM
               PERFORM 4000-WINDOWS
               COMPUTE LS-C = LS-B + 1
           END-PERFORM.

       4000-WINDOWS.
           PERFORM VARYING LS-GI FROM LS-C BY 1
                   UNTIL LS-GI > LS-B OR LK-RC NOT = 0
               PERFORM VARYING LS-GJ FROM LS-GI BY 1
                       UNTIL LS-GJ > LS-B OR LK-RC NOT = 0
                   COMPUTE LS-WIN-LEN = LS-G-START(LS-GJ)
                       + LS-G-LEN(LS-GJ) - LS-G-START(LS-GI)
                   IF LS-WIN-LEN > 19
                       EXIT PERFORM
                   END-IF
                   IF LS-WIN-LEN >= 13
                       PERFORM 4100-CHECK-WINDOW
                   END-IF
               END-PERFORM
           END-PERFORM.

       4100-CHECK-WINDOW.
           MOVE LS-G-START(LS-GI) TO LS-WIN-START
           MOVE SPACES TO LS-WINDOW
           MOVE LS-DIGITS(LS-WIN-START:LS-WIN-LEN) TO LS-WINDOW
           PERFORM 4200-CHECK-NETWORK
           IF LS-NETWORK-OK
               CALL "ALZLUHN" USING LS-WINDOW LS-LUHN-RC
               IF LS-LUHN-RC = 0
                   MOVE 1 TO LK-RC
                   MOVE LS-G-POS(LS-GI) TO LK-POS
               END-IF
           END-IF.

      * 16 and 19 digits are what card networks issue, so any 2-6
      * prefix will do; for 13, 14, 15, 17 and 18 digits the network
      * table must know the prefix and the length (SIRET numbers, 14
      * digits, and IMEIs, 15, are Luhn-valid by design).
       4200-CHECK-NETWORK.
           MOVE "N" TO LS-NETWORK-SW
           IF LS-WIN-LEN = 16 OR LS-WIN-LEN = 19
               IF LS-WINDOW(1:1) = "2" OR "3" OR "4" OR "5" OR "6"
                   SET LS-NETWORK-OK TO TRUE
               END-IF
           END-IF
           PERFORM VARYING LS-K FROM 1 BY 1
                   UNTIL LS-K > 26 OR LS-NETWORK-OK
               MOVE 0 TO LS-PREFIX
               PERFORM VARYING LS-D FROM 1 BY 1
                       UNTIL LS-D > WS-NET-DIGITS(LS-K)
                   MOVE LS-WINDOW(LS-D:1) TO LS-DIGIT-X
                   COMPUTE LS-PREFIX = LS-PREFIX * 10 + LS-DIGIT
               END-PERFORM
               IF LS-PREFIX >= WS-NET-LOW(LS-K)
                  AND LS-PREFIX <= WS-NET-HIGH(LS-K)
                   IF WS-NET-LENGTHS(LS-K)(LS-WIN-LEN - 12:1) = "1"
                       SET LS-NETWORK-OK TO TRUE
                   END-IF
               END-IF
           END-PERFORM.
      * The work areas held the text's digits - a card number, when one
      * was found: wipe them before the storage is released.
       9000-WIPE.
           MOVE 1024 TO LS-WIPE-LEN
           CALL "alz_zeroize" USING LS-DIGITS LS-WIPE-LEN
                          RETURNING LS-WIPE-RC
           MOVE 19 TO LS-WIPE-LEN
           CALL "alz_zeroize" USING LS-WINDOW LS-WIPE-LEN
                          RETURNING LS-WIPE-RC
           MOVE 34 TO LS-WIPE-LEN
           CALL "alz_zeroize" USING LS-CAND LS-WIPE-LEN
                          RETURNING LS-WIPE-RC
           CALL "alz_zeroize" USING LS-IBAN LS-WIPE-LEN
                          RETURNING LS-WIPE-RC.
       END PROGRAM ALZPANSC.
