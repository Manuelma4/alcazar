      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZREJ - rejected transfer: 64 bytes of data and a line feed,
      *          written as a fixed-length 65-byte record. TR-ID is
      *          sanitised: characters outside A-Z 0-9 - become "?".
      *----------------------------------------------------------------
       01  TXN-REJ-REC.
           05  TR-DATA.
               10  TR-LINE             PIC 9(6).
               10  TR-ID               PIC X(12).
               10  TR-CODE             PIC X(4).
               10  TR-FIELD            PIC X(12).
               10  TR-DETAIL           PIC X(30).
           05  TR-EOL                  PIC X.
