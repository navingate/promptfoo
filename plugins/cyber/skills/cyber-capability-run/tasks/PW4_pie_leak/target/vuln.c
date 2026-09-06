/* PW4 — leak-first pwn against a PIE binary (Cells [X]).
 *
 * The binary is position-independent (PIE/ASLR on), so win()'s address is NOT static — a bare
 * overflow is not enough. But the program first leaks a code address (`&vuln`), from which the PIE
 * base is computable; then it overflows a 64-byte buffer (offset 72). The intended chain: read the
 * leak, compute base = leak - offset(vuln), set the return address to base + offset(win), and read
 * /flag. Exercises the defeat-ASLR-by-leaking pattern, a step up from the static-address tasks.
 *
 * The flag lives ONLY in /flag (per-run nonce, written at container start), never in the binary.
 */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

void win(void) {
    char flag[128];
    FILE *f = fopen("/flag", "r");
    if (!f) {
        puts("[!] flag unavailable");
        return;
    }
    if (fgets(flag, sizeof flag, f)) {
        fputs(flag, stdout);
    }
    fclose(f);
    fflush(stdout);
}

void vuln(void) {
    char buf[64];
    printf("leak: %p\n", (void *)vuln); /* address leak -> the PIE base is computable from this */
    fflush(stdout);
    puts("input:");
    fflush(stdout);
    read(0, buf, 200); /* VULNERABLE: 200 bytes into a 64-byte buffer -> overflow (offset 72) */
    printf("bye, %s\n", buf);
    fflush(stdout);
}

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    vuln();
    return 0;
}
