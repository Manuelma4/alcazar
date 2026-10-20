C=======================================================================
C     LOANCALC - CONSUMER LOAN AMORTISATION, FIXED FORM (HARDENED)
C
C     Hardened counterpart of examples/vulnerable/loancalc.f:
C     - IMPLICIT NONE in every program unit;
C     - money is held in integer cents (INTEGER(KIND=8)) and the rate
C       in basis points, so there is no floating-point comparison;
C     - no COMMON or EQUIVALENCE: data is passed as arguments;
C     - block IF and SELECT CASE instead of arithmetic IF / GO TO;
C     - IOSTAT on every OPEN, READ and CLOSE;
C     - explicit-shape arrays with the length passed in, and nested
C       IFs so an index is checked before it is used.
C=======================================================================
      PROGRAM LOANCALC
      IMPLICIT NONE
      INTEGER, PARAMETER :: MAXTRM = 360
      INTEGER(KIND=8) BALANCE, PAYMNT, SCHED(MAXTRM)
      INTEGER RATEBP, NTERM, LKIND, IOS, FIRST
C
      OPEN (UNIT=10, FILE='LOANS.DAT', STATUS='OLD', IOSTAT=IOS)
      IF (IOS .NE. 0) STOP 'LOANS.DAT: OPEN FAILED'
      READ (10, 100, IOSTAT=IOS) BALANCE, RATEBP, NTERM, LKIND
  100 FORMAT (I12, I6, I4, I2)
      IF (IOS .NE. 0) STOP 'LOANS.DAT: BAD RECORD'
      CLOSE (10, IOSTAT=IOS)
      IF (NTERM .LT. 1 .OR. NTERM .GT. MAXTRM) STOP 'BAD TERM'
      IF (BALANCE .LT. 0 .OR. RATEBP .LT. 0) STOP 'BAD AMOUNT'
C
      SELECT CASE (LKIND)
      CASE (1)
         CALL AMORT(SCHED, NTERM, BALANCE, RATEBP, PAYMNT)
      CASE (2)
         SCHED = 0
         SCHED(NTERM) = BALANCE
         PAYMNT = 0
      CASE (3)
         SCHED = BALANCE
         PAYMNT = (BALANCE * RATEBP + 60000) / 120000
      CASE DEFAULT
         STOP 'UNKNOWN LOAN KIND'
      END SELECT
C
      IF (BALANCE .LE. 100000000) THEN
         WRITE (6, 200) BALANCE / 100, MOD(BALANCE, 100_8),
     &                  PAYMNT / 100, MOD(PAYMNT, 100_8)
  200    FORMAT (' BALANCE ', I10, '.', I2.2,
     &           ' PAYMENT ', I8, '.', I2.2)
      ELSE
         WRITE (6, *) ' LOAN ABOVE LIMIT, MANUAL REVIEW'
      END IF
      CALL FIRSTDUE(SCHED, NTERM, FIRST)
      WRITE (6, *) ' FIRST PERIOD DUE: ', FIRST
      END
C
C     Annuity schedule in integer cents, interest rounded half up.
      SUBROUTINE AMORT(SCHED, N, PRINCP, RATEBP, PAYMNT)
      IMPLICIT NONE
      INTEGER N, RATEBP, I
      INTEGER(KIND=8) SCHED(N), PRINCP, PAYMNT, OWED, INTRST
      PAYMNT = (PRINCP + N - 1) / N
      OWED = PRINCP
      DO 10 I = 1, N
         INTRST = (OWED * RATEBP + 60000) / 120000
         OWED = MAX(0_8, OWED + INTRST - PAYMNT)
         SCHED(I) = OWED
   10 CONTINUE
      END
C
C     First period that still has a balance due (0 when none).
      SUBROUTINE FIRSTDUE(SCHED, N, FIRST)
      IMPLICIT NONE
      INTEGER N, FIRST, I
      INTEGER(KIND=8) SCHED(N)
      FIRST = 0
      DO 10 I = 1, N
         IF (SCHED(I) .GT. 0) THEN
            FIRST = I
            RETURN
         END IF
   10 CONTINUE
      END
