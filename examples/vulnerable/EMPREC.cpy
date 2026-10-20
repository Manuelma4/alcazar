000100*================================================================
000200* EMPREC - EMPLOYEE MASTER RECORD, COPYBOOK FOR PAYROLL.cob
000300* Part of the intentionally vulnerable Watchtower demo set.
000400*================================================================
000500 01  EMP-RECORD.
000600     05  EMP-ID                  PIC X(8).
000700     05  EMP-FULL-NAME           PIC X(30).
000800     05  EMP-IBAN                PIC X(34).
000900     05  EMP-ANNUAL-SALARY       PIC 9(7)V99.
001000     05  EMP-BONUS               PIC 9(5)V99.
001100     05  EMP-TAX-CODE            PIC X(4).
