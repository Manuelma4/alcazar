      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZTXNIN - inbound transfer record, fixed length (RECFM=FB,
      *            LRECL=200). No line terminator: a newline in the
      *            data can never start a new record.
      *----------------------------------------------------------------
       01  TXN-IN-REC.
           05  TI-ID                   PIC X(12).
           05  TI-TS                   PIC X(14).
           05  TI-FROM-IBAN            PIC X(34).
           05  TI-TO-IBAN              PIC X(34).
           05  TI-AMOUNT               PIC X(18).
           05  TI-CURRENCY             PIC X(3).
           05  TI-PAN                  PIC X(19).
           05  TI-CHANNEL              PIC X(3).
               88  TI-CHANNEL-VALID    VALUE "ATM" "WEB" "POS"
                                             "BRN" "MOB" "API".
           05  TI-MEMO                 PIC X(40).
           05  FILLER                  PIC X(23).
