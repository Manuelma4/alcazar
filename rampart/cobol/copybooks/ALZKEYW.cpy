      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZKEYW - working storage for ALZKEYP (key handling shared by
      *           TXNGUARD and LEDGERCK). Requires ALZCAPI.
      *----------------------------------------------------------------
       01  ALZ-PROGRAM-NAME            PIC X(8).
       01  ALZ-KEY-STATUS              PIC X VALUE "N".
           88  ALZ-KEYS-READY          VALUE "Y".
           88  ALZ-KEYS-FAILED         VALUE "F".
      * Which sub-keys the program is given: K-ledger always, K-token
      * only when the program pseudonymises (TXNGUARD). The master key
      * never reaches a legacy program.
       01  ALZ-KEY-SET                 PIC X VALUE "L".
           88  ALZ-NEEDS-TOKEN-KEY     VALUE "T".
       01  ALZ-KEY-HEX                 PIC X(80).
       01  ALZ-KEY-BIN                 PIC X(32).
       01  ALZ-LEDGER-KEY              PIC X(32).
       01  ALZ-TOKEN-KEY               PIC X(32).
       01  ALZ-KDF-INFO                PIC X(64).
       01  ALZ-KDF-LEN                 PIC S9(9) COMP-5.
       01  ALZ-JOB-ARG                 PIC X(80).
       01  ALZ-JOB-ID                  PIC X(32).
       01  ALZ-JOB-LEN                 PIC S9(9) COMP-5.
       01  ALZ-GENESIS                 PIC X(64).
