# SPDX-License-Identifier: Apache-2.0
# Alcazar — build and test the COBOL / Fortran core.
#
#   make            libraries, batch programs and tools  -> build/
#   make test       Fortran + COBOL test suites
#   make check      test + Node.js tests + Watchtower self-scan
#   make demo       run a sample batch end to end from the command line
#   make clean
#
# Toolchain: GnuCOBOL >= 3.1 and gfortran >= 12. See docs/HARDENING.md for
# what every flag below defends against.

SHELL   := /bin/sh
.SUFFIXES:
.DELETE_ON_ERROR:

# Make's built-in default for FC is f77; only override that default.
ifeq ($(origin FC),default)
  FC := gfortran
endif
COBC    ?= cobc
NODE    ?= node

BUILD   := build
OBJ     := $(BUILD)/obj
MOD     := $(BUILD)/mod
LIB     := $(BUILD)/lib
BIN     := $(BUILD)/bin

UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
  SHLIB_EXT := dylib
  LD_HARDEN :=
else
  SHLIB_EXT := so
  # Full RELRO + immediate binding: the GOT is read-only after start-up.
  LD_HARDEN := -Wl,-z,relro,-z,now,-z,noexecstack
endif

# ---------------------------------------------------------------- Fortran ---
# Strict standard conformance; every warning is an error.
F_STRICT := -std=f2018 -fimplicit-none -Wall -Wextra -Wpedantic -Wconversion \
            -Wimplicit-interface -Wimplicit-procedure -Wcharacter-truncation \
            -Wsurprising -Werror
# Run-time checks (array bounds, DO loops, allocation, pointers, recursion),
# poisoned uninitialised values and a stack protector.
F_HARDEN := -O2 -g -fcheck=bounds,do,mem,pointer,recursion -finit-real=snan \
            -finit-integer=-2147483647 -finit-logical=false \
            -fstack-protector-strong -fPIC
FFLAGS   ?= $(F_STRICT) $(F_HARDEN)

GFORTRAN_LIBDIR := $(shell dirname "$$($(FC) -print-file-name=libgfortran.$(SHLIB_EXT))")

# ------------------------------------------------------------------ COBOL ---
# -debug          : every run-time check (EC-ALL: subscripts, reference
#                   modification, numeric data, PERFORM stack).
# -fstatic-call   : CALL "literal" is linked statically, so no module search
#                   path (COB_LIBRARY_PATH) can be used to hijack a call.
# -A / -Q         : hardening flags for the generated C and the link.
C_HARDEN  := -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fno-strict-aliasing
COB_WARN  := -Wall
COBFLAGS  ?= -std=default -O2 -debug -fstatic-call $(COB_WARN) -A "$(C_HARDEN)" \
             $(if $(LD_HARDEN),-Q "$(LD_HARDEN)")
COB_INC   := -I rampart/cobol/copybooks

# ------------------------------------------------------------------ files ---
F_MODULES := rampart_bytes rampart_sha256 rampart_ct rampart_hmac rampart_kat rampart_capi \
             rampart_stats rampart_json
F_OBJS    := $(F_MODULES:%=$(OBJ)/%.o)
RAMPART_F := $(LIB)/librampart_f.a

COB_MODULES := ALZTEXT ALZSANIT ALZIBAN ALZLUHN ALZMASK ALZAMNT ALZDATE ALZCCY
COB_OBJS    := $(COB_MODULES:%=$(OBJ)/cobol/%.o)
RAMPART_COB := $(LIB)/librampart_cob.a
COPYBOOKS   := $(wildcard rampart/cobol/copybooks/*.cpy)

APPS  := $(BIN)/txnguard $(BIN)/ledgerck $(BIN)/fraudscan
TOOLS := $(BIN)/alzsum $(BIN)/alzselftest $(BIN)/alzhmac
TESTS := $(BIN)/test_crypto $(BIN)/test_stats $(BIN)/test_rampart_cob

LINK_FORTRAN := $(RAMPART_F) -L"$(GFORTRAN_LIBDIR)" -lgfortran

.PHONY: all lib apps tools test test-fortran test-cobol check demo clean manifest

all: lib apps tools manifest

lib: $(RAMPART_F) $(RAMPART_COB)
apps: $(APPS)
tools: $(TOOLS)

$(OBJ) $(OBJ)/cobol $(MOD) $(LIB) $(BIN):
	@mkdir -p $@

# Fortran modules, in dependency order.
$(OBJ)/%.o: rampart/fortran/src/%.f90 | $(OBJ) $(MOD)
	$(FC) $(FFLAGS) -J$(MOD) -I$(MOD) -c $< -o $@

# Module names must never equal a C binding label (both are global
# identifiers): see docs/HARDENING.md, "the recursion that wasn't".
$(OBJ)/rampart_sha256.o: $(OBJ)/rampart_bytes.o
$(OBJ)/rampart_ct.o: $(OBJ)/rampart_bytes.o
$(OBJ)/rampart_hmac.o: $(OBJ)/rampart_sha256.o $(OBJ)/rampart_ct.o
$(OBJ)/rampart_kat.o: $(OBJ)/rampart_hmac.o
$(OBJ)/rampart_capi.o: $(OBJ)/rampart_kat.o

$(RAMPART_F): $(F_OBJS) | $(LIB)
	rm -f $@
	ar rcs $@ $(F_OBJS)

# COBOL library modules (callable subprograms).
$(OBJ)/cobol/%.o: rampart/cobol/src/%.cob $(COPYBOOKS) | $(OBJ)/cobol
	$(COBC) -c $(COBFLAGS) $(COB_INC) -o $@ $<

$(RAMPART_COB): $(COB_OBJS) | $(LIB)
	rm -f $@
	ar rcs $@ $(COB_OBJS)

# Batch programs.
$(BIN)/txnguard: apps/txnguard/TXNGUARD.cob $(RAMPART_COB) $(RAMPART_F) $(COPYBOOKS) | $(BIN)
	$(COBC) -x $(COBFLAGS) $(COB_INC) -o $@ $< $(RAMPART_COB) $(LINK_FORTRAN)

$(BIN)/ledgerck: apps/ledgerck/LEDGERCK.cob $(RAMPART_COB) $(RAMPART_F) $(COPYBOOKS) | $(BIN)
	$(COBC) -x $(COBFLAGS) $(COB_INC) -o $@ $< $(RAMPART_COB) $(LINK_FORTRAN)

$(BIN)/fraudscan: apps/fraudscan/fraudscan.f90 $(RAMPART_F) | $(BIN)
	$(FC) $(FFLAGS) -I$(MOD) $< $(RAMPART_F) -o $@ $(LD_HARDEN)

# Tools.
$(BIN)/%: rampart/fortran/tools/%.f90 $(RAMPART_F) | $(BIN)
	$(FC) $(FFLAGS) -I$(MOD) $< $(RAMPART_F) -o $@ $(LD_HARDEN)

# Tests.
$(BIN)/test_%: rampart/fortran/test/test_%.f90 $(RAMPART_F) | $(BIN)
	$(FC) $(FFLAGS) -I$(MOD) $< $(RAMPART_F) -o $@ $(LD_HARDEN)

$(BIN)/test_rampart_cob: rampart/cobol/test/TESTRAMP.cob $(RAMPART_COB) $(RAMPART_F) $(COPYBOOKS) | $(BIN)
	$(COBC) -x $(COBFLAGS) $(COB_INC) -o $@ $< $(RAMPART_COB) $(LINK_FORTRAN)

test: test-fortran test-cobol

test-fortran: $(BIN)/test_crypto $(BIN)/test_stats
	$(BIN)/test_crypto
	$(BIN)/test_stats

test-cobol: $(BIN)/test_rampart_cob
	$(BIN)/test_rampart_cob

check: all test
	$(NODE) --test
	$(NODE) watchtower/bin/watchtower.mjs scan rampart apps --fail-on low

# Build manifest consumed by Gatehouse's /api/posture endpoint.
manifest: | $(BUILD)
	@sh scripts/build-manifest.sh '$(COBC)' '$(FC)' '$(COBFLAGS)' '$(FFLAGS)' > $(BUILD)/manifest.json

$(BUILD):
	@mkdir -p $@

demo: all
	@sh scripts/demo.sh

clean:
	rm -rf $(BUILD)
