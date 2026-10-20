/* SPDX-License-Identifier: Apache-2.0
 *
 * alz.h - C ABI of the Rampart Fortran kernel (librampart_f.a).
 *
 * Every argument is passed by reference, including lengths, so the same
 * entry points serve COBOL (CALL "alz_..." USING BY REFERENCE ...
 * RETURNING rc) and C. Every function returns an int32_t status: ALZ_OK or a
 * negative ALZ_E_* code. Lengths are validated (0 <= len <= ALZ_MAX_LEN)
 * before any buffer is read or written.
 *
 * Link with: librampart_f.a -lgfortran
 */
#ifndef ALZ_H
#define ALZ_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ALZ_OK            0
#define ALZ_DIFFERENT     1   /* alz_ct_equal: the buffers differ */
#define ALZ_E_LENGTH     (-1) /* a length is negative or above ALZ_MAX_LEN */
#define ALZ_E_HEX        (-2) /* malformed hexadecimal input */
#define ALZ_E_CAPACITY   (-3) /* output buffer too small, or more input than expected */
#define ALZ_E_EOF        (-4) /* alz_read_line: end of input, nothing read */
#define ALZ_E_IO         (-5) /* alz_read_line, alz_expect_eof: read(2) failed */
#define ALZ_E_TRUNCATED  (-6) /* alz_read_line: input ended inside a line */
#define ALZ_E_SELFTEST  (-10) /* a known-answer test failed */

#define ALZ_MAX_LEN      16777216 /* 16 MiB per buffer */

/* SHA-256 (FIPS 180-4). digest receives 32 bytes, hex 64 characters. */
int32_t alz_sha256(const uint8_t *msg, const int32_t *len, uint8_t digest[32]);
int32_t alz_sha256_hex(const uint8_t *msg, const int32_t *len, char hex[64]);

/* HMAC-SHA256 (RFC 2104). Intermediate key material is wiped. */
int32_t alz_hmac_sha256(const uint8_t *key, const int32_t *keylen,
                        const uint8_t *msg, const int32_t *msglen,
                        uint8_t mac[32]);
int32_t alz_hmac_sha256_hex(const uint8_t *key, const int32_t *keylen,
                            const uint8_t *msg, const int32_t *msglen,
                            char hex[64]);

/* Constant-time comparison: ALZ_OK when equal, ALZ_DIFFERENT otherwise. */
int32_t alz_ct_equal(const uint8_t *a, const uint8_t *b, const int32_t *len);

/* Hexadecimal codec. alz_hex_encode writes 2 * len characters. */
int32_t alz_hex_encode(const uint8_t *bytes, const int32_t *len, char *hex);
int32_t alz_hex_decode(const char *hex, const int32_t *hexlen,
                       uint8_t *out, const int32_t *outcap, int32_t *outlen);

/* Overwrite a buffer with zeros (stores the compiler may not remove). */
int32_t alz_zeroize(uint8_t *buf, const int32_t *len);

/* Secrets on standard input, without stdio: alz_read_line reads one line
 * with read(2), byte by byte, into buf (the line feed is not stored), so
 * the caller's buffer is the only copy to wipe. alz_expect_eof returns
 * ALZ_OK only if nothing is left on standard input. */
int32_t alz_read_line(uint8_t *buf, const int32_t *cap, int32_t *len);
int32_t alz_expect_eof(void);
/* Wipe what was buffered from standard input but not handed over. */
int32_t alz_discard_input(void);

/* Power-on self-test: ALZ_OK when every known-answer test passes. */
int32_t alz_selftest(void);

#ifdef __cplusplus
}
#endif

#endif /* ALZ_H */
