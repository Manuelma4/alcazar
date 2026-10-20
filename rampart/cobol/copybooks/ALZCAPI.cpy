      * SPDX-License-Identifier: Apache-2.0
      *----------------------------------------------------------------
      * ALZCAPI - work areas for calls into the Rampart Fortran kernel.
      *
      * The kernel speaks the C ABI (rampart/fortran/include/alz.h):
      * every argument BY REFERENCE, lengths as 32-bit native binary
      * (COMP-5), and an int32 status in RETURNING - never a void
      * call, which would leave garbage in RETURN-CODE.
      *----------------------------------------------------------------
       01  ALZ-RC                      PIC S9(9) COMP-5.
           88  ALZ-OK                  VALUE 0.
       01  ALZ-POS                     PIC S9(9) COMP-5.
       01  ALZ-KEY-LEN                 PIC S9(9) COMP-5.
       01  ALZ-MSG-LEN                 PIC S9(9) COMP-5.
       01  ALZ-HEX-LEN                 PIC S9(9) COMP-5.
       01  ALZ-OUT-CAP                 PIC S9(9) COMP-5.
       01  ALZ-OUT-LEN                 PIC S9(9) COMP-5.
       01  ALZ-WIPE-RC                 PIC S9(9) COMP-5.
       01  ALZ-MAC-HEX                 PIC X(64).
