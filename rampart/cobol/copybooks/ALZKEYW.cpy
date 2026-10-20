      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZKEYW - working storage for ALZKEYP (key handling shared by
      *           TXNGUARD and LEDGERCK). Requires ALZCAPI.
      *----------------------------------------------------------------
       01  ALZ-PROGRAM-NAME            PIC X(8).
       01  ALZ-KEY-STATUS              PIC X VALUE "N".
           88  ALZ-KEYS-READY          VALUE "Y".
           88  ALZ-KEYS-FAILED         VALUE "F".
      * The master key lives only between ALZ-READ-KEY and
      * ALZ-DERIVE-KEYS; the derived keys are wiped by ALZ-WIPE-KEYS.
       01  ALZ-KEY-HEX                 PIC X(80).
       01  ALZ-MASTER-KEY              PIC X(32).
       01  ALZ-LEDGER-KEY              PIC X(32).
       01  ALZ-TOKEN-KEY               PIC X(32).
       01  ALZ-KDF-INFO                PIC X(64).
       01  ALZ-KDF-LEN                 PIC S9(9) COMP-5.
       01  ALZ-JOB-ARG                 PIC X(80).
       01  ALZ-JOB-ID                  PIC X(32).
       01  ALZ-JOB-LEN                 PIC S9(9) COMP-5.
       01  ALZ-GENESIS                 PIC X(64).
