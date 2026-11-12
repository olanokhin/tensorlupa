// Проверка движка визуализации на Mac: viz/engine/cli model.bin
//  1) трасса согласована: lens(resid[L]) == логиты модели, resid[l+1] == resid[l] + attn_out[l] + mlp_out[l],
//     веса внимания каждой головы в сумме 1;
//  2) запись трассы не меняет генерацию: токены совпадают с копией цикла из прошивки при том же seed;
//  3) печатает истории и сколько раз сработали автомат и маска.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../esp/microqwen.h"
#include "viz.h"

static uint8_t *read_file(const char *p, long *n) {
    FILE *f = fopen(p, "rb"); if (!f) return NULL;
    fseek(f, 0, SEEK_END); *n = ftell(f); fseek(f, 0, SEEK_SET);
    uint8_t *b = malloc(*n); if (fread(b, 1, *n, f) != (size_t)*n) { fclose(f); return NULL; } fclose(f); return b;
}

// копия generate() из прошивки (без трассы) — эталон для сравнения токенов
static int ref_generate(MQModel *M, const char *prompt, const char *words, uint64_t seed, int steps, int *out) {
    int ids[256]; int n = mq_encode(M, prompt, ids, 200);
    static MQWordBias wb; static MQWordFSM fsm; static char text[4096]; static int gen[256];
    int tl = 0, ng = 0;
    mq_wb_init(&wb, M, words, 2.0f, 100.0f, 0.5f);
    mq_fsm_init(&fsm, M, &wb, 2, 4.0f);
    uint64_t rng = seed;
    for (int i = 0; i < n - 1; i++) mq_forward(M, ids[i], i);
    int tok = ids[n - 1], pos = n - 1, cnt = 0;
    while (cnt < steps && pos < M->max_pos - 1) {
        mq_forward(M, tok, pos++);
        int bt[MQ_WB_MAXW + 1]; float bb[MQ_WB_MAXW + 1]; int nb = 0, form = -1;
        int forced = wb.n ? mq_fsm_step(&fsm, &wb, M, text, tl, gen, ng, bt, bb, &nb, MQ_WB_MAXW + 1, &form) : -1;
        for (int q = 0; q < nb; q++) M->logits[bt[q]] += bb[q];
        if (form >= 0) {
            int nx[16]; int nn = mq_fsm_next(&fsm, form, nx, 16);
            for (int t = 0; t < M->vocab; t++) {
                if (!mq_tok_letter(M, t)) continue;
                int ok = 0; for (int i = 0; i < nn; i++) ok |= nx[i] == t;
                if (!ok) M->logits[t] = -1e30f;
            }
        }
        tok = forced >= 0 ? forced : mq_sample(M, 0.6f, 40, &rng);
        out[cnt++] = tok;
        if (tok <= 2) break;
        int bl; const uint8_t *b = mq_token_bytes(M, tok, &bl);
        gen[ng++] = tok; memcpy(text + tl, b, bl); tl += bl;
    }
    return cnt;
}

// промпт заказа как в прошивке и engine.js: слова через запятую
static void order_prompt(char *out, size_t n, const char *words) {
    char w[3][24] = {{0}}; int k = sscanf(words, "%23s %23s %23s", w[0], w[1], w[2]);
    snprintf(out, n, "<|im_start|>user\nWrite a short story. Use the words: %s%s%s%s%s.<|im_end|>\n<|im_start|>assistant\n",
             w[0], k > 1 ? ", " : "", w[1], k > 2 ? ", " : "", w[2]);
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s model.bin\n", argv[0]); return 1; }
    long len; uint8_t *buf = read_file(argv[1], &len);
    if (!buf || viz_load(buf, (int)len)) { fprintf(stderr, "не загрузилась модель\n"); return 1; }
    int V = viz_info(0), d = viz_info(1), L = viz_info(3), H = viz_info(4), P = viz_info(7);
    if (argc >= 6 && !strcmp(argv[2], "--dump")) {      // cli model.bin --dump "words" seed out.bin: токены + логиты шагов
        char prompt[512];
        order_prompt(prompt, sizeof prompt, argv[3]);
        viz_settings(0.6f, 40, (uint32_t)atoi(argv[4]), 2.0f, 100.0f, 0.5f, 1, 2, 4.0f, 0, 0, 200);
        viz_begin(prompt, argv[3]);
        static float lg[300][4096]; static int toks[300]; int n = 0, nt = 0, k;
        while ((k = viz_step()) > 0 && n < 300) { memcpy(lg[n++], viz_logits_raw(), V * 4); if (k == 2) toks[nt++] = viz_step_int(2); }
        FILE *f = fopen(argv[5], "wb");
        fwrite(&nt, 4, 1, f); fwrite(toks, 4, nt, f); fwrite(&n, 4, 1, f); fwrite(lg, 4, (size_t)n * V, f); fclose(f);
        printf("%d токенов ответа, %d шагов\n", nt, n);
        return 0;
    }
    if (argc >= 5 && !strcmp(argv[2], "--tokens")) {   // cli model.bin --tokens "words" seed — токены ответа для сверки с WebAssembly
        char prompt[512];
        order_prompt(prompt, sizeof prompt, argv[3]);
        viz_settings(0.6f, 40, (uint32_t)atoi(argv[4]), 2.0f, 100.0f, 0.5f, 1, 2, 4.0f, 0, 0, 200);
        viz_begin(prompt, argv[3]);
        int k, first = 1; double sum = 0;
        while ((k = viz_step()) > 0) {
            if (k == 2) { printf("%s%d", first ? "" : ",", viz_step_int(2)); first = 0; }
            for (int i = 0; i < V; i++) sum += viz_logits_raw()[i];
        }
        printf("\nlogits_sum %.6f\n", sum);
        return 0;
    }
    printf("модель: vocab %d, dim %d, inter %d, слоёв %d, голов %d, контекст %d\n", V, d, viz_info(2), L, H, P);

    static MQModel R;                                  // вторая копия модели для эталона (без трассы)
    uint8_t *buf2 = malloc(len); memcpy(buf2, buf, len);
    if (mq_load(&R, buf2, len)) { fprintf(stderr, "эталон не загрузился\n"); return 1; }

    const char *orders[] = {"play luxury shiny", "dragon cookie school", "swim octopus funny", "moon", "", NULL};
    int bad_lens = 0, bad_resid = 0, bad_attn = 0, bad_tok = 0, steps_all = 0, forced_all = 0, masked_all = 0;
    for (int o = 0; orders[o]; o++) {
        for (uint32_t seed = 1; seed <= 3; seed++) {
            char prompt[512];
            if (orders[o][0])
                order_prompt(prompt, sizeof prompt, orders[o]);
            else snprintf(prompt, sizeof prompt, "Once upon a time");
            viz_settings(0.6f, 40, seed, 2.0f, 100.0f, 0.5f, 1, 2, 4.0f, 0, 0, 200);
            viz_begin(prompt, orders[o]);
            int got[256], ng = 0, k;
            static char story[8192]; int sl = 0;
            while ((k = viz_step()) > 0) {
                steps_all++;
                // 1) logit lens последнего остаточного потока == логиты модели
                viz_lens(viz_tr_resid() + (size_t)L * d);
                if (memcmp(viz_lens_out(), viz_logits_raw(), V * 4)) bad_lens++;
                // 2) остаточный поток складывается из вкладов
                for (int l = 0; l < L; l++)
                    for (int i = 0; i < d; i++) {
                        float r = viz_tr_resid()[l * d + i] + viz_tr_attn_out()[l * d + i];
                        r = r + viz_tr_mlp_out()[l * d + i];
                        if (r != viz_tr_resid()[(l + 1) * d + i]) { bad_resid++; l = L; break; }
                    }
                // 3) веса внимания в сумме 1
                int pos = viz_step_int(0);
                for (int x = 0; x < L * H; x++) {
                    double s = 0; for (int t = 0; t <= pos; t++) s += viz_tr_attn_p()[(size_t)x * P + t];
                    if (fabs(s - 1) > 1e-3) bad_attn++;
                }
                if (k == 2) {
                    got[ng++] = viz_step_int(2);
                    forced_all += viz_step_int(4) >= 0;
                    masked_all += viz_step_int(5) >= 0;
                    int bl; const uint8_t *b = viz_token_bytes(viz_step_int(2), &bl);
                    if (viz_step_int(2) > 2 && sl + bl < (int)sizeof story - 1) { memcpy(story + sl, b, bl); sl += bl; }
                }
            }
            story[sl] = 0;
            int ref[256]; int nr = orders[o][0] ? ref_generate(&R, prompt, orders[o], seed, 200, ref) : -1;
            if (nr >= 0 && (nr != ng || memcmp(ref, got, ng * sizeof(int)))) bad_tok++;
            if (seed == 1) {
                printf("\n[%s] %d токенов, слова %d/%d: %.160s...\n", orders[o][0] ? orders[o] : "(без заказа)", ng,
                       viz_step_int(12), viz_step_int(11), story);
            }
        }
    }
    printf("\nшагов %d | lens != логиты: %d | остаточный поток не сходится: %d | внимание не 1: %d | "
           "токены != прошивка: %d из 12 прогонов | принудительных кусков %d, масок суффиксов %d\n",
           steps_all, bad_lens, bad_resid, bad_attn, bad_tok, forced_all, masked_all);
    return bad_lens || bad_resid || bad_attn || bad_tok;
}
