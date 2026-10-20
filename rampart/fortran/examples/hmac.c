/* SPDX-License-Identifier: Apache-2.0
 *
 * Calling the Rampart Fortran kernel from C.
 *
 *   cc -std=c11 -Wall -Wextra -I rampart/fortran/include \
 *      rampart/fortran/examples/hmac.c build/lib/librampart_f.a \
 *      -L"$(dirname "$(gfortran -print-file-name=libgfortran.a)")" -lgfortran
 */
#include <stdio.h>
#include <string.h>

#include "alz.h"

int main(void) {
    if (alz_selftest() != ALZ_OK) {
        fputs("kernel self-test failed\n", stderr);
        return 1;
    }

    const char *key = "key";
    const char *msg = "The quick brown fox jumps over the lazy dog";
    int32_t keylen = (int32_t)strlen(key);
    int32_t msglen = (int32_t)strlen(msg);
    char hex[65] = {0};

    if (alz_hmac_sha256_hex((const uint8_t *)key, &keylen, (const uint8_t *)msg, &msglen, hex) != ALZ_OK) {
        return 1;
    }
    printf("HMAC-SHA256 = %s\n", hex);

    /* Constant-time comparison against the RFC-documented value. */
    const char *expected = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
    int32_t n = 64;
    puts(alz_ct_equal((const uint8_t *)hex, (const uint8_t *)expected, &n) == ALZ_OK ? "matches" : "DIFFERS");

    /* Lengths are validated before any buffer is touched. */
    int32_t bad = -1;
    printf("negative length -> %d (ALZ_E_LENGTH)\n", alz_sha256((const uint8_t *)msg, &bad, (uint8_t *)hex));
    return 0;
}
