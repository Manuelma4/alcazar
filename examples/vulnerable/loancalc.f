C=======================================================================
C     LOANCALC - CONSUMER LOAN AMORTISATION (FORTRAN 77, FIXED FORM)
C
C     !!! INTENTIONALLY VULNERABLE - DO NOT USE IN PRODUCTION !!!
C     Demo material for Watchtower, the Alcazar static analyzer.
C     Every flaw is deliberate; the fixed version is
C     examples/hardened/loancalc.f.
C
C     Planted flaws: implicit typing, COMMON and EQUIVALENCE, REAL*4
C     money, exact floating-point comparison, arithmetic IF, computed
C     GO TO, I/O without IOSTAT, an assumed-size dummy array and a
C     bound check that Fortran does not short-circuit.
C=======================================================================
      PROGRAM LOANCALC
      REAL*4 BALANCE, RATE, PAYMENT
      REAL*4 SCHED(360)
      INTEGER NTERM, LKIND
      COMMON /LOANDB/ BALANCE, RATE, NTERM
      EQUIVALENCE (PAYMENT, IPAYBITS)
C
      OPEN (UNIT=10, FILE='LOANS.DAT', STATUS='OLD')
      READ (10, 100) BALANCE, RATE, NTERM, LKIND
  100 FORMAT (F12.2, F8.5, I4, I2)
      CLOSE (10)
C
C     Promotional loans are interest free: RATE is "exactly" zero.
      IF (RATE .EQ. 0.0) THEN
         PAYMENT = BALANCE / NTERM
      ELSE
         PAYMENT = BALANCE * RATE / (1.0 - (1.0 + RATE)**(-NTERM))
      END IF
C
C     LKIND: 1 = annuity, 2 = balloon, 3 = interest only
      GO TO (10, 20, 30) LKIND
   10 CALL AMORT(SCHED, NTERM, PAYMENT)
      GO TO 40
   20 SCHED(NTERM) = BALANCE
      GO TO 40
   30 PAYMENT = BALANCE * RATE
   40 CONTINUE
C
      IF (BALANCE - 1000000.0) 50, 50, 60
   50 WRITE (6, 200) BALANCE, PAYMENT
  200 FORMAT (' BALANCE ', F12.2, ' PAYMENT ', F10.2)
      GO TO 70
   60 WRITE (6, *) ' LOAN ABOVE LIMIT, MANUAL REVIEW'
   70 CONTINUE
      CALL FIRSTDUE(SCHED, NTERM)
      STOP
      END
C
C     Builds the balance schedule. SCHED has no known length here.
      SUBROUTINE AMORT(SCHED, N, PAYMENT)
      REAL*4 SCHED(*)
      REAL*4 BALANCE, RATE, PAYMENT, INTEREST
      INTEGER N, NTERM
      COMMON /LOANDB/ BALANCE, RATE, NTERM
      DO 10 I = 1, N
         INTEREST = BALANCE * RATE
         BALANCE = BALANCE + INTEREST - PAYMENT
         SCHED(I) = BALANCE
   10 CONTINUE
      RETURN
      END
C
C     Finds the first period that still has a balance due.
      SUBROUTINE FIRSTDUE(SCHED, N)
      INTEGER N, I
      REAL*4 SCHED(N)
      I = 1
C     The bound test does not protect SCHED(I): no short-circuit.
   10 IF (I .LE. N .AND. SCHED(I) .LE. 0.0) THEN
         I = I + 1
         GO TO 10
      END IF
      WRITE (6, *) ' FIRST PERIOD DUE: ', I
      RETURN
      END
