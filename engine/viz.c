#define _POSIX_C_SOURCE 200112L
// Движок визуализации: см. viz.h. Логика шага генерации повторяет прошивку (esp/idf/main/main.c, generate),
// выбор токена — та же mq_sample, что на плате; дополнительно всё записывается для показа.
#include "viz.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "../../esp/microqwen.h"

static MQModel M;
static int loaded;
static MQTrace TR;
static float *logits_raw, *logits_final, *lens_out, *wbuf;

static struct {
    float temperature; int top_k; uint32_t seed; float wb_base, wb_tau, wb_start;
    int fsm_on, fsm_lock; float fsm_bonus, loop_imm, loop_mult; int max_new;
} S = {0.6f, 40, 1, 2.0f, 100.0f, 0.5f, 1, 2, 4.0f, 0.0f, 0.0f, 240};

static int ids[256], n_prompt, pos, done;
static int gen[256], ng;
static int force_ans[256], n_force;
static char text[4096]; static int tl;
static uint64_t rng;
static MQWordBias wb;
static MQWordFSM fsm;

enum { I_POS, I_IN, I_OUT, I_KIND, I_FORCED, I_FORM, I_NB, I_NL, I_NA, I_NK, I_GEN, I_WORDS, I_USED, I_N };
static int si[I_N];
static float sf[2];
static int bias_tok[8]; static float bias_val[8];
static int loop_tok[48]; static float loop_val[48];
static int allowed[16];
static int topk_tok[64]; static float topk_p[64];
static int word_st[VIZ_MAX_WORDS][4];

int viz_load(const uint8_t *buf, int len) {
    if (loaded) { mq_free(&M); free(TR.resid); free(TR.attn_out); free(TR.mlp_act); free(TR.mlp_out); free(TR.attn_p);
                  free(TR.final_norm); free(TR.head_out); free(TR.v_out); free(wbuf); free(logits_raw); free(logits_final); free(lens_out); loaded = 0; }
    // mq_load ссылается на буфер — держим свою копию, выровненную на 16 (W4R требует; malloc в WebAssembly даёт 8)
    void *copy = NULL;
    if (posix_memalign(&copy, 16, (size_t)len) != 0) return -100;
    memcpy(copy, buf, len);
    int rc = mq_load(&M, copy, len);
    if (rc) return rc;
    int d = M.dim, L = M.layers;
    TR.resid = calloc((size_t)(L + 1) * d, 4);
    TR.attn_out = calloc((size_t)L * d, 4);
    TR.mlp_act = calloc((size_t)L * M.inter, 4);
    TR.mlp_out = calloc((size_t)L * d, 4);
    TR.attn_p = calloc((size_t)L * M.heads * M.max_pos, 4);
    TR.final_norm = calloc(d, 4);
    TR.head_out = calloc((size_t)L * M.heads * M.head_dim, 4);
    TR.v_out = calloc((size_t)L * M.kv_heads * M.head_dim, 4);
    { size_t a = (size_t)d * M.heads * M.head_dim, b = (size_t)d * M.inter; wbuf = calloc(a > b ? a : b, 4); }
    logits_raw = calloc(M.vocab, 4); logits_final = calloc(M.vocab, 4); lens_out = calloc(M.vocab, 4);
    mq_trace = &TR;
    loaded = 1;
    return 0;
}

void viz_settings(float temperature, int top_k, uint32_t seed, float wb_base, float wb_tau, float wb_start,
                  int fsm_on, int fsm_lock, float fsm_bonus, float loop_imm, float loop_mult, int max_new) {
    S.temperature = temperature; S.top_k = top_k; S.seed = seed; S.wb_base = wb_base; S.wb_tau = wb_tau;
    S.wb_start = wb_start; S.fsm_on = fsm_on; S.fsm_lock = fsm_lock; S.fsm_bonus = fsm_bonus;
    S.loop_imm = loop_imm; S.loop_mult = loop_mult; S.max_new = max_new;
}

int viz_begin(const char *prompt, const char *words) {
    if (!loaded) return -1;
    n_prompt = mq_encode(&M, prompt, ids, 200);
    pos = 0; done = n_prompt == 0; ng = 0; tl = 0; text[0] = 0;
    rng = S.seed ? S.seed : 1;
    n_force = 0;
    mq_wb_init(&wb, &M, words ? words : "", S.wb_base, S.wb_tau, S.wb_start);
    mq_fsm_init(&fsm, &M, &wb, S.fsm_lock, S.fsm_bonus);
    memset(si, 0, sizeof si);
    return n_prompt;
}

// как word_in в microqwen.c: слово как начало слова, без учёта регистра
static int word_in(const char *t, int n, const char *w, int wl) {
    for (int i = 0; i + wl <= n; i++) {
        if (i > 0) { char c = t[i - 1]; if ((c | 32) >= 'a' && (c | 32) <= 'z') continue; if (c >= '0' && c <= '9') continue; if (c == '_') continue; }
        int k = 0;
        while (k < wl && ((t[i + k] | 32) == w[k] || t[i + k] == w[k])) k++;
        if (k == wl) return 1;
    }
    return 0;
}

static void topk_probs(const float *lg) {        // кандидаты и вероятности, как в mq_sample
    int k = S.top_k; if (k <= 0 || k > 64) k = 64;
    int n = 0;
    for (int i = 0; i < M.vocab; i++) {
        float v = lg[i];
        if (n < k) { topk_tok[n] = i; topk_p[n] = v; n++; }
        else if (v > topk_p[n - 1]) { topk_tok[n - 1] = i; topk_p[n - 1] = v; }
        else continue;
        for (int j = n - 1; j > 0 && topk_p[j] > topk_p[j - 1]; j--) {
            float tv = topk_p[j]; topk_p[j] = topk_p[j - 1]; topk_p[j - 1] = tv;
            int ti = topk_tok[j]; topk_tok[j] = topk_tok[j - 1]; topk_tok[j - 1] = ti;
        }
    }
    float T = S.temperature > 0 ? S.temperature : 1e-3f, sum = 0, top = topk_p[0];
    for (int j = 0; j < n; j++) { topk_p[j] = topk_p[j] <= -1e29f ? 0 : expf((topk_p[j] - top) / T); sum += topk_p[j]; }
    float ent = 0;
    for (int j = 0; j < n; j++) { topk_p[j] /= sum; if (topk_p[j] > 0) ent -= topk_p[j] * log2f(topk_p[j]); }
    si[I_NK] = n; sf[1] = ent;
}

static void word_states(int form) {
    int used = 0;
    for (int i = 0; i < wb.n && i < VIZ_MAX_WORDS; i++) {
        int u = word_in(text, tl, wb.word[i], wb.wlen[i]), k = 0, sl = wb.slen[i];
        for (int kk = (sl - 1 < ng ? sl - 1 : ng); kk > 0; kk--)
            if (!memcmp(gen + ng - kk, wb.seq[i], kk * sizeof(int))) { k = kk; break; }
        int st = 0;
        if (form >= 0 && fsm.fword[form] == i) st = 3;
        else if (S.fsm_on && k >= S.fsm_lock) st = 2;
        else if (k == 1) st = 1;
        else if (u) st = 4;
        word_st[i][0] = st; word_st[i][1] = k; word_st[i][2] = sl; word_st[i][3] = u;
        used += u;
    }
    si[I_WORDS] = wb.n; si[I_USED] = used;
}

void viz_force(const int *answer, int n) {
    n_force = n < 0 ? 0 : n > 256 ? 256 : n;
    if (n_force) memcpy(force_ans, answer, n_force * sizeof(int));
}

int viz_step(void) {
    if (!loaded) return -1;
    if (done || pos >= M.max_pos - 1 || (pos >= n_prompt - 1 && ng >= S.max_new)) { done = 1; return 0; }
    if (n_force && pos >= n_prompt - 1 && ng >= n_force) { done = 1; return 0; }
    int in = pos < n_prompt ? ids[pos] : gen[ng - 1];   // промпт, затем последний сгенерированный токен
    float *lg = mq_forward(&M, in, pos);
    memcpy(logits_raw, lg, M.vocab * 4);
    si[I_POS] = pos; si[I_IN] = in; si[I_FORCED] = -1; si[I_FORM] = -1; si[I_NB] = si[I_NL] = si[I_NA] = 0;
    si[I_GEN] = ng; sf[0] = 0;

    if (pos < n_prompt - 1) {                      // шаг промпта: следующий токен известен
        memcpy(logits_final, lg, M.vocab * 4);
        topk_probs(lg);
        si[I_KIND] = 1; si[I_OUT] = ids[pos + 1];
        word_states(-1);
        pos++;
        return 1;
    }
    // шаг генерации — как в прошивке
    int nb = 0, form = -1, forced = -1;
    if (wb.n) {
        if (S.fsm_on) forced = mq_fsm_step(&fsm, &wb, &M, text, tl, gen, ng, bias_tok, bias_val, &nb, 8, &form);
        else nb = mq_wb_step(&wb, text, tl, gen, ng, bias_tok, bias_val);
    }
    if (forced < 0) {
        for (int q = 0; q < nb; q++) lg[bias_tok[q]] += bias_val[q];
        if (form >= 0) {
            int nn = mq_fsm_next(&fsm, form, allowed, 16);
            si[I_NA] = nn;
            for (int t = 0; t < M.vocab; t++) {
                if (!mq_tok_letter(&M, t)) continue;
                int ok = 0;
                for (int i = 0; i < nn; i++) ok |= allowed[i] == t;
                if (!ok) lg[t] = -1e30f;
            }
        }
        if (wb.n && (S.loop_imm != 0 || S.loop_mult != 0)) {
            int nl = mq_loop_step(&M, gen, ng, S.loop_imm, S.loop_mult, 1.75f, 32, loop_tok, loop_val, 48), m = 0;
            for (int q = 0; q < nl; q++) {
                int pushed = 0;
                for (int r = 0; r < nb; r++) pushed |= bias_tok[r] == loop_tok[q];
                if (!pushed) { lg[loop_tok[q]] += loop_val[q]; loop_tok[m] = loop_tok[q]; loop_val[m] = loop_val[q]; m++; }
            }
            si[I_NL] = m;
        }
    }
    memcpy(logits_final, lg, M.vocab * 4);
    topk_probs(lg);
    int tok;
    if (n_force) tok = force_ans[ng];                 // «на том же тексте»: токен задан, rng не тратится
    else if (forced >= 0) tok = forced;
    else {
        uint64_t before = rng;
        tok = mq_sample(&M, S.temperature, S.top_k, &rng);
        // доля суммы, куда попал бросок (для показа): тот же xorshift, что в mq_sample
        uint64_t s = before; s ^= s >> 12; s ^= s << 25; s ^= s >> 27;
        sf[0] = (float)((uint32_t)((s * 0x2545F4914F6CDD1DULL) >> 32) / 4294967296.0);
    }
    si[I_KIND] = 2; si[I_OUT] = tok; si[I_FORCED] = forced; si[I_FORM] = form; si[I_NB] = forced >= 0 ? 0 : nb;
    if (forced >= 0) { bias_tok[0] = forced; bias_val[0] = 1e9f; si[I_NB] = 1; }
    if (tok <= 2) { done = 1; word_states(form); return 2; }
    int bl; const uint8_t *b = mq_token_bytes(&M, tok, &bl);
    if (ng < 256) gen[ng++] = tok;
    if (tl + bl < (int)sizeof text - 1) { memcpy(text + tl, b, bl); tl += bl; text[tl] = 0; }
    word_states(form);
    pos++;
    return 2;
}

void viz_lens(const float *x) { mq_project(&M, x, lens_out); }

int viz_info(int what) {
    int v[] = {M.vocab, M.dim, M.inter, M.layers, M.heads, M.kv_heads, M.head_dim, M.max_pos};
    return what >= 0 && what < 8 ? v[what] : 0;
}
const uint8_t *viz_token_bytes(int id, int *len) { return mq_token_bytes(&M, id, len); }
int viz_token_len(int id) { int l; mq_token_bytes(&M, id, &l); return l; }
const uint8_t *viz_token_ptr(int id) { int l; return mq_token_bytes(&M, id, &l); }

float *viz_tr_resid(void) { return TR.resid; }
float *viz_tr_attn_out(void) { return TR.attn_out; }
float *viz_tr_mlp_act(void) { return TR.mlp_act; }
float *viz_tr_mlp_out(void) { return TR.mlp_out; }
float *viz_tr_attn_p(void) { return TR.attn_p; }
float *viz_tr_final_norm(void) { return TR.final_norm; }
float *viz_tr_head_out(void) { return TR.head_out; }
float *viz_tr_v_out(void) { return TR.v_out; }
float *viz_weights(int layer, int which) { mq_dequant(&M, layer, which, wbuf); return wbuf; }
float *viz_logits_raw(void) { return logits_raw; }
float *viz_logits_final(void) { return logits_final; }
float *viz_lens_out(void) { return lens_out; }
int viz_step_int(int i) { return i >= 0 && i < I_N ? si[i] : 0; }
float viz_step_float(int i) { return i >= 0 && i < 2 ? sf[i] : 0; }
int *viz_bias_tok(void) { return bias_tok; }
float *viz_bias_val(void) { return bias_val; }
int *viz_loop_tok(void) { return loop_tok; }
float *viz_loop_val(void) { return loop_val; }
int *viz_allowed(void) { return allowed; }
int *viz_topk_tok(void) { return topk_tok; }
float *viz_topk_p(void) { return topk_p; }
int viz_word_int(int i, int what) { return i >= 0 && i < VIZ_MAX_WORDS && what >= 0 && what < 4 ? word_st[i][what] : 0; }
const char *viz_word_text(int i) { return i >= 0 && i < wb.n ? wb.word[i] : ""; }
float viz_wb(int what) {
    switch (what) {
    case 0: return wb.base;
    case 1: return wb.u0;
    case 2: return (float)si[I_USED];
    case 3: return (float)(ng - wb.since);
    case 4: return wb.tau;
    }
    return 0;
}
