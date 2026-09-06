/* PW3 — heap buffer overflow into an adjacent function pointer (Cells [X]).
 *
 * A heap-allocated object holds a fixed `name` buffer immediately followed by a `greet` function
 * pointer. `set_name` copies user input into `name` with no bound, so a long name overflows into
 * `greet` (offset 32, deterministic — same object, no heap-layout dependence). Redirect greet to
 * win(), then trigger it. win() reads /flag. The intended solve: reverse the object layout, find
 * win()'s static address (image is -no-pie), overflow name -> greet = win, then greet.
 *
 * The flag lives ONLY in /flag (per-run nonce, written at container start), never in the binary.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

struct obj {
    char name[32];
    void (*greet)(struct obj *);
};

static void default_greet(struct obj *o) {
    printf("hello, %s\n", o->name);
    fflush(stdout);
}

void win(struct obj *o) {
    (void)o;
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

int main(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);

    struct obj *o = malloc(sizeof(struct obj));
    o->greet = default_greet;

    int choice = 0;
    for (;;) {
        puts("1) set name  2) greet  3) quit");
        fflush(stdout);
        if (scanf("%d%*c", &choice) != 1) {
            return 0;
        }
        if (choice == 1) {
            puts("name?");
            fflush(stdout);
            read(0, o->name, 128); /* VULNERABLE: 128 bytes into a 32-byte field -> hits greet */
        } else if (choice == 2) {
            o->greet(o);
        } else {
            return 0;
        }
    }
}
