      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZREJ - rejected transfer (64 bytes). TR-ID is sanitised:
      *          characters outside A-Z 0-9 - become "?".
      *----------------------------------------------------------------
       01  TXN-REJ-REC.
           05  TR-LINE                 PIC 9(6).
           05  TR-ID                   PIC X(12).
           05  TR-CODE                 PIC X(4).
           05  TR-FIELD                PIC X(12).
           05  TR-DETAIL               PIC X(30).
