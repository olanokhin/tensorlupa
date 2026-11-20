// Copy of esp/microqwen.c from micro-qwen3 (commit b6c7957) — the same C engine as the ESP32-S3 firmware.
// Update with scripts/sync-engine.sh; do not edit here.
#include "microqwen.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

// ---------------------------------------------------------------- загрузка
typedef struct { const uint8_t *p, *end; int ok; } Rd;

static const void *take(Rd *r, size_t n) {
    if (!r->ok || (size_t)(r->end - r->p) < n) { r->ok = 0; return NULL; }
    const void *v = r->p; r->p += n; return v;
}
static uint32_t u32(Rd *r) { const uint8_t *b = take(r, 4); return b ? (uint32_t)b[0] | b[1] << 8 | b[2] << 16 | (uint32_t)b[3] << 24 : 0; }
static float f32(Rd *r) { uint32_t u = u32(r); float f; memcpy(&f, &u, 4); return f; }

static int g_bits = 8;   // формат файла при загрузке (8 — W8, 4 — W4)
static int g_rowscale = 0;   // W4R

static MQMat mat(Rd *r, int out, int in) {
    MQMat m = {0};
    m.out = out; m.in = in; m.bits = g_bits;
    if (g_bits == 4 && g_rowscale) {               // W4R: полубайты + f32 масштаб на строку
        m.groups = (in + 31) / 32; m.rowscale = 1;
        m.q4 = take(r, (size_t)out * m.groups * 16);
        m.s = take(r, (size_t)out * 4);
        take(r, (16 - ((size_t)out * 4) % 16) % 16);
        if (((uintptr_t)m.q4 & 15) != 0) r->ok = 0;
        return m;
    }
    if (g_bits == 4) {
        m.groups = (in + 31) / 32;
        m.q4 = take(r, (size_t)out * m.groups * 16);
        size_t sb = (size_t)out * m.groups * 2;
        m.s4 = take(r, sb);
        take(r, (16 - sb % 16) % 16);                 // выравнивание следующей матрицы
        if (((uintptr_t)m.q4 & 15) != 0) r->ok = 0;   // векторные загрузки требуют 16
        return m;
    }
    m.q = take(r, (size_t)out * in);
    m.s = take(r, (size_t)out * 4);    // f32 масштабы: адрес должен быть кратен 4 (Xtensa не читает невыровненное)
    if (((uintptr_t)m.s & 3) != 0) r->ok = 0;
    return m;
}

static inline float h2f(uint16_t h) {   // fp16 -> fp32 (масштабы: положительные нормальные числа или 0)
    uint32_t e = (h >> 10) & 31, mant = h & 1023, u;
    if (e == 0) return 0.0f;
    u = ((uint32_t)(h & 0x8000) << 16) | ((e - 15 + 127) << 23) | (mant << 13);
    float f; memcpy(&f, &u, 4); return f;
}

int mq_load(MQModel *m, const uint8_t *buf, size_t len) {
    memset(m, 0, sizeof *m);
    Rd r = {buf, buf + len, 1};
    if (len < 4 || memcmp(buf, "MQW3", 4) != 0) return -1;
    r.p += 4;
    uint32_t ver = u32(&r);
    if (ver < 1 || ver > 4) return -2;
    g_bits = m->bits = ver == 1 ? 8 : 4;
    g_rowscale = m->rowscale = ver >= 3;
    m->has_head = ver == 4;
    m->vocab = u32(&r); m->dim = u32(&r); m->inter = u32(&r); m->layers = u32(&r);
    m->heads = u32(&r); m->kv_heads = u32(&r); m->head_dim = u32(&r); m->max_pos = u32(&r);
    m->rope_theta = f32(&r); m->eps = f32(&r);
    int d = m->dim, hd = m->head_dim, qd = m->heads * hd, kvd = m->kv_heads * hd;

    m->emb = mat(&r, m->vocab, d);
    m->final_norm = take(&r, d * 4);
    if (m->has_head) m->head = mat(&r, m->vocab, d);
    m->L = MQ_MALLOC(sizeof(MQLayer) * m->layers);
    for (int l = 0; l < m->layers; l++) {
        MQLayer *L = &m->L[l];
        L->in_norm = take(&r, d * 4); L->post_norm = take(&r, d * 4);
        L->q_norm = take(&r, hd * 4); L->k_norm = take(&r, hd * 4);
        L->q = mat(&r, qd, d); L->k = mat(&r, kvd, d); L->v = mat(&r, kvd, d); L->o = mat(&r, d, qd);
        L->gate = mat(&r, m->inter, d); L->up = mat(&r, m->inter, d); L->down = mat(&r, d, m->inter);
    }
    int n = u32(&r);
    if (n != m->vocab) return -3;
    m->tok_bytes = MQ_MALLOC(sizeof(uint8_t *) * n);
    m->tok_len = MQ_MALLOC(n);
    for (int i = 0; i < n; i++) {
        const uint8_t *l = take(&r, 1);
        m->tok_len[i] = l ? *l : 0;
        m->tok_bytes[i] = take(&r, m->tok_len[i]);
    }
    m->n_merges = u32(&r);
    const uint8_t *mg = take(&r, (size_t)m->n_merges * 6);
    if (!r.ok) return -4;
    m->merges = MQ_MALLOC((size_t)m->n_merges * 6);   // копия: в файле таблица не выровнена
    memcpy(m->merges, mg, (size_t)m->n_merges * 6);

    int maxw = d > m->inter ? d : m->inter;
    if (qd > maxw) maxw = qd;
    m->x = MQ_MALLOC(d * 4); m->xn = MQ_MALLOC(d * 4);
    m->q = MQ_MALLOC(qd * 4); m->k = MQ_MALLOC(kvd * 4); m->v = MQ_MALLOC(kvd * 4);
    m->att = MQ_MALLOC(qd * 4); m->hb = MQ_MALLOC(m->inter * 4); m->hb2 = MQ_MALLOC(m->inter * 4);
    m->logits = MQ_MALLOC(m->vocab * 4); m->scores = MQ_MALLOC(m->max_pos * 4);
    m->xq = MQ_MALLOC_A16((maxw + 31) & ~31);         // W4: вход дополняется нулями до кратного 32
    m->gsum = MQ_MALLOC(((maxw + 31) / 32) * 4);
    size_t kv = (size_t)m->layers * m->max_pos * kvd;
    m->kv8 = mq_kv_int8 && (hd % 16 == 0) && (m->max_pos % 16 == 0);
    if (m->kv8) {   // ~200 КБ вместо ~800 КБ: на ESP32-S3 помещается во внутреннюю SRAM
        size_t per = (size_t)m->max_pos * hd;                    // один (слой, голова) K или V: ~16 КБ
        m->kv_blocks = m->layers * m->kv_heads;
        if (m->kv_blocks > 64) return -7;
        // каждый блок — во внутреннюю SRAM, если там есть место, иначе во внешнюю память
        m->kv_blocks_internal = 0;
        for (int b = 0; b < m->kv_blocks; b++) {
            int8_t **slots[2] = {&m->kq_h[b], &m->vqT_h[b]};
            for (int j = 0; j < 2; j++) {
                *slots[j] = mq_kv_in_psram ? NULL : MQ_MALLOC_A16(per);
                if (*slots[j]) m->kv_blocks_internal++;
                else *slots[j] = MQ_MALLOC_A16_EXT(per);
                if (!*slots[j]) { mq_free(m); return -6; }
            }
            memset(m->vqT_h[b], 0, per);
        }
        (void)kv;
        m->ks = MQ_MALLOC((size_t)m->layers * m->max_pos * m->kv_heads * 4);
        m->vs = MQ_MALLOC((size_t)m->layers * m->max_pos * m->kv_heads * 4);
        m->qq = MQ_MALLOC_A16(hd); m->wq = MQ_MALLOC_A16(m->max_pos);
        if (!m->ks || !m->vs || !m->qq || !m->wq) { mq_free(m); return -6; }
    } else {
        m->kcache = MQ_MALLOC(kv * 4); m->vcache = MQ_MALLOC(kv * 4);
    }
    // таблица RoPE: cos/sin для всех позиций и частот (half = head_dim/2)
    int half = hd / 2;
    m->rope_cos = MQ_MALLOC((size_t)m->max_pos * half * 4);
    m->rope_sin = MQ_MALLOC((size_t)m->max_pos * half * 4);
    for (int p = 0; p < m->max_pos; p++)
        for (int i = 0; i < half; i++) {
            double a = p * pow(m->rope_theta, -2.0 * i / hd);
            m->rope_cos[p * half + i] = (float)cos(a);
            m->rope_sin[p * half + i] = (float)sin(a);
        }
    return m->x && (m->kv8 || (m->kcache && m->vcache)) ? 0 : -5;
}

void mq_free(MQModel *m) {
    void *ps[] = {m->L, m->tok_bytes, m->tok_len, m->x, m->xn, m->q, m->k, m->v, m->att, m->hb, m->hb2,
                  m->logits, m->scores, m->xq, m->kcache, m->vcache, m->rope_cos, m->rope_sin, m->merges,
                  m->ks, m->vs, m->qq, m->wq, m->gsum};
    for (size_t i = 0; i < sizeof ps / sizeof *ps; i++) MQ_FREE(ps[i]);
    for (int b = 0; b < 64; b++) { MQ_FREE(m->kq_h[b]); MQ_FREE(m->vqT_h[b]); m->kq_h[b] = m->vqT_h[b] = NULL; }
}

// ---------------------------------------------------------------- ядра
static void rmsnorm(float *o, const float *x, const float *w, int n, float eps) {
    float ss = 0;
    for (int i = 0; i < n; i++) ss += x[i] * x[i];
    float r = 1.0f / sqrtf(ss / n + eps);
    for (int i = 0; i < n; i++) o[i] = x[i] * r * w[i];
}

// ---- скалярное произведение int8 × int8 -> int32: горячая точка всего инференса
int mq_pie_enabled = 1;
int mq_kv_int8 = 1;
int mq_kv_in_psram = 0;
uint32_t mq_pie_fallbacks = 0;
uint64_t mq_prof_us[MQP_N];
uint64_t (*mq_now_us)(void) = NULL;
#if defined(MQ_PROFILE)
#define PROF_T(v) uint64_t v = mq_now_us ? mq_now_us() : 0
#define PROF_ADD(k, t0) do { if (mq_now_us) { uint64_t _t = mq_now_us(); mq_prof_us[k] += _t - (t0); (t0) = _t; } } while (0)
#else
#define PROF_T(v) (void)0
#define PROF_ADD(k, t0) (void)0
#endif
void (*mq_parallel)(MQRowsFn fn, float *y, const MQMat *W, const int8_t *xq, float sx) = NULL;

int32_t mq_dot_s8(const int8_t *w, const int8_t *x, int n) {
#if defined(MQ_PIE)
    // ESP32-S3 PIE: 16 произведений int8 за инструкцию с накоплением в 40-битный ACCX.
    // Требования: адреса кратны 16 (ee.vld.128 игнорирует младшие 4 бита), n кратно 16.
    if (mq_pie_enabled && ((((uintptr_t)w) | ((uintptr_t)x)) & 15) == 0 && (n & 15) == 0) {
        int32_t r;
        __asm__ volatile("ee.zero.accx" ::: "memory");
        for (int i = 0; i < n; i += 16)
            __asm__ volatile("ee.vld.128.ip q0, %0, 16\n\t"
                             "ee.vld.128.ip q1, %1, 16\n\t"
                             "ee.vmulas.s8.accx q0, q1"
                             : "+r"(w), "+r"(x)::"memory");
        __asm__ volatile("movi a8, 0\n\tee.srs.accx %0, a8, 0" : "=r"(r)::"a8");
        return r;
    }
    if (mq_pie_enabled) mq_pie_fallbacks++;
#endif
    int32_t acc = 0;
    for (int i = 0; i < n; i++) acc += (int32_t)w[i] * x[i];
    return acc;
}

static void rows_q8(float *y, const MQMat *W, const int8_t *xq, float sx, int r0, int r1) {
    for (int o = r0; o < r1; o++)
        y[o] = (float)mq_dot_s8(W->q + (size_t)o * W->in, xq, W->in) * W->s[o] * sx;
}

// ---- W4: одна группа из 32 весов (16 байт полубайтов) × 32 входа int8 -> int32, без поправки на «−8»
#if defined(MQ_PIE)
static const uint8_t MASK0F[16] __attribute__((aligned(16))) = {15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15};
#endif

static inline int32_t dot_u4_group(const uint8_t *w, const int8_t *x) {
#if defined(MQ_PIE)
    if (mq_pie_enabled) {
        // Распаковка в регистрах: младшие полубайты — AND 0x0F, старшие — сдвиг 32-битных дорожек на 4 и AND.
        int32_t r;
        __asm__ volatile("movi a9, 4\n\t"
                         "ssr a9\n\t"
                         "ee.vld.128.ip q7, %[m], 0\n\t"
                         "ee.vld.128.ip q0, %[w], 0\n\t"
                         "ee.vld.128.ip q1, %[x], 16\n\t"
                         "ee.vld.128.ip q2, %[x], 0\n\t"
                         "ee.andq q3, q0, q7\n\t"
                         "ee.vsr.32 q4, q0\n\t"
                         "ee.andq q4, q4, q7\n\t"
                         "ee.zero.accx\n\t"
                         "ee.vmulas.s8.accx q3, q1\n\t"
                         "ee.vmulas.s8.accx q4, q2\n\t"
                         "movi a9, 0\n\t"
                         "ee.srs.accx %[r], a9, 0"
                         : [r] "=r"(r), [x] "+r"(x)
                         : [w] "r"(w), [m] "r"(MASK0F)
                         : "a9", "memory");
        return r;
    }
#endif
    int32_t acc = 0;
    for (int i = 0; i < 16; i++) acc += (int32_t)(w[i] & 15) * x[i] + (int32_t)(w[i] >> 4) * x[16 + i];
    return acc;
}

int32_t mq_dot_u4(const uint8_t *w, const int8_t *x) { return dot_u4_group(w, x); }

// W4R: вся строка (groups × 32 весов) в одном аккумуляторе — конвейер как у int8 плюс распаковка.
// Возвращает Σ u·x без поправки на нулевую точку (её вычитает вызывающий: −8·Σx один раз на строку).
int32_t mq_dot_u4row(const uint8_t *w, const int8_t *x, int groups) {
#if defined(MQ_PIE)
    if (mq_pie_enabled) {
        int32_t r;
        __asm__ volatile("ee.vld.128.ip q7, %[m], 0\n\t"   // маска 0x0F — один раз на строку
                         "ee.zero.accx" : : [m] "r"(MASK0F) : "memory");
        for (int g = 0; g < groups; g++)
            __asm__ volatile("movi a9, 4\n\t"
                             "ssr a9\n\t"
                             "ee.vld.128.ip q0, %[w], 16\n\t"
                             "ee.vld.128.ip q1, %[x], 16\n\t"
                             "ee.vld.128.ip q2, %[x], 16\n\t"
                             "ee.andq q3, q0, q7\n\t"
                             "ee.vsr.32 q4, q0\n\t"
                             "ee.andq q4, q4, q7\n\t"
                             "ee.vmulas.s8.accx q3, q1\n\t"
                             "ee.vmulas.s8.accx q4, q2"
                             : [w] "+r"(w), [x] "+r"(x) : : "a9", "memory");
        __asm__ volatile("movi a9, 0\n\tee.srs.accx %0, a9, 0" : "=r"(r) : : "a9");
        return r;
    }
#endif
    int32_t acc = 0;
    for (int g = 0; g < groups; g++) acc += dot_u4_group(w + g * 16, x + g * 32);
    return acc;
}

static int32_t g_xsum;   // W4R: Σ квантованного входа по всей (дополненной) строке

static void rows_q4r(float *y, const MQMat *W, const int8_t *xq, float sx, int r0, int r1) {
    int G = W->groups;
    for (int o = r0; o < r1; o++)
        y[o] = (float)(mq_dot_u4row(W->q4 + (size_t)o * G * 16, xq, G) - 8 * g_xsum) * W->s[o] * sx;
}

static int32_t g_gsum_buf[64];  // хватает на вход до 2048
static const int32_t *g_gsum;   // суммы входа по группам для текущего умножения (читает и второе ядро)

static void rows_q4(float *y, const MQMat *W, const int8_t *xq, float sx, int r0, int r1) {
    int G = W->groups;
    for (int o = r0; o < r1; o++) {
        const uint8_t *wr = W->q4 + (size_t)o * G * 16;
        const uint16_t *sr = W->s4 + (size_t)o * G;
        float acc = 0;
        for (int g = 0; g < G; g++)
            acc += (float)(dot_u4_group(wr + g * 16, xq + g * 32) - 8 * g_gsum[g]) * h2f(sr[g]);
        y[o] = acc * sx;
    }
}

// Симметричное квантование вектора в int8 по max|x|; возвращает масштаб.
static float quant_s8(int8_t *q, const float *x, int n) {
    float amax = 0;
    for (int i = 0; i < n; i++) { float a = fabsf(x[i]); if (a > amax) amax = a; }
    float s = amax / 127.0f + 1e-12f, inv = 1.0f / s;
    for (int i = 0; i < n; i++) {
        float t = roundf(x[i] * inv);
        q[i] = (int8_t)(t > 127 ? 127 : t < -127 ? -127 : t);
    }
    return s;
}

// y = W x в W8A8: x квантуется в int8 (симметрично, по max|x|), int32-накопление, затем масштабы.
static void matmul_q8(float *y, const MQMat *W, const float *x, int8_t *xq) {
    float amax = 0;
    for (int i = 0; i < W->in; i++) { float a = fabsf(x[i]); if (a > amax) amax = a; }
    float sx = amax / 127.0f + 1e-12f, inv = 1.0f / sx;
    for (int i = 0; i < W->in; i++) {
        float t = roundf(x[i] * inv);
        xq[i] = (int8_t)(t > 127 ? 127 : t < -127 ? -127 : t);
    }
    MQRowsFn fn = rows_q8;
    if (W->bits == 4 && W->rowscale) {
        int padded = W->groups * 32;
        memset(xq + W->in, 0, padded - W->in);
        int32_t sum = 0;
        for (int i = 0; i < W->in; i++) sum += xq[i];
        g_xsum = sum;
        fn = rows_q4r;
    } else if (W->bits == 4) {
        int padded = W->groups * 32;
        memset(xq + W->in, 0, padded - W->in);
        for (int g = 0; g < W->groups; g++) {        // поправка на нулевую точку: dot(u-8, x) = dot(u, x) - 8·Σx
            int32_t sum = 0;
            for (int i = 0; i < 32; i++) sum += xq[g * 32 + i];
            g_gsum_buf[g] = sum;
        }
        g_gsum = g_gsum_buf;
        fn = rows_q4;
    }
    if (mq_parallel) mq_parallel(fn, y, W, xq, sx);
    else fn(y, W, xq, sx, 0, W->out);
}

static void rope(float *v, int nheads, int hd, const float *cs, const float *sn) {
    int half = hd / 2;   // «rotate half»: пары (i, i + hd/2), как mx.fast.rope(traditional=False)
    for (int h = 0; h < nheads; h++) {
        float *x = v + h * hd;
        for (int i = 0; i < half; i++) {
            float a = x[i], b = x[i + half];
            x[i] = a * cs[i] - b * sn[i];
            x[i + half] = b * cs[i] + a * sn[i];
        }
    }
}

static float silu(float x) { return x / (1.0f + expf(-x)); }

#ifdef MQ_TRACE
MQTrace *mq_trace = NULL;
static float *g_tr_p;   // куда attend_head* пишут веса внимания текущей головы (NULL — не писать)
#define TR_COPY(dst, src, n) do { if (mq_trace) memcpy((dst), (src), (size_t)(n) * 4); } while (0)
#else
#define TR_COPY(dst, src, n) do { } while (0)
#endif

// Голова внимания на int8 KV-cache. q·k: int8 × int8 через mq_dot_s8 (PIE на ESP32-S3).
// Сумма по позициям: веса w_t = p_t · s_v(t) квантуются в int8, V хранится транспонированным
// ([head_dim][max_pos]), поэтому out[i] = s_w · dot(w, V^T[i]) — тоже непрерывное скалярное произведение.
static __attribute__((noinline)) void attend_head_q8(float *out, const float *qh, const int8_t *kq, const float *ks,
                                                     const int8_t *vT, const float *vs, int8_t *qq, int8_t *wq,
                                                     float *scores, int pos, int hd, int kvd, int kvh_stride,
                                                     int max_pos, float scale) {
    float sq = quant_s8(qq, qh, hd);
    float mx = -1e30f;
    for (int t = 0; t <= pos; t++) {
        float s = (float)mq_dot_s8(qq, kq + (size_t)t * kvd, hd) * sq * ks[(size_t)t * kvh_stride] * scale;
        scores[t] = s;
        if (s > mx) mx = s;
    }
    float sum = 0;
    for (int t = 0; t <= pos; t++) { scores[t] = expf(scores[t] - mx); sum += scores[t]; }
    float inv = 1.0f / sum;
#ifdef MQ_TRACE
    if (g_tr_p) for (int t = 0; t <= pos; t++) g_tr_p[t] = scores[t] * inv;
#endif
    for (int t = 0; t <= pos; t++) scores[t] *= inv * vs[(size_t)t * kvh_stride];
    int L = (pos + 16) & ~15;               // длина, кратная 16; хвост весов — нули
    float sw = quant_s8(wq, scores, pos + 1);
    memset(wq + pos + 1, 0, L - pos - 1);
    for (int i = 0; i < hd; i++) out[i] = (float)mq_dot_s8(wq, vT + (size_t)i * max_pos, L) * sw;
}

// Одна голова внимания: softmax(q·K^T / sqrt(hd)) · V по позициям 0..pos.
// Отдельная функция (noinline): в одной большой mq_forward xtensa-gcc падал с internal compiler error.
static __attribute__((noinline)) void attend_head(float *out, const float *qh, const float *kc, const float *vc,
                                                  float *scores, int pos, int hd, int kvd, float scale) {
    float mx = -1e30f;
    for (int t = 0; t <= pos; t++) {
        const float *kt = kc + (size_t)t * kvd;
        float s = 0;
        for (int i = 0; i < hd; i++) s += qh[i] * kt[i];
        s *= scale;
        scores[t] = s;
        if (s > mx) mx = s;
    }
    float sum = 0;
    for (int t = 0; t <= pos; t++) { scores[t] = expf(scores[t] - mx); sum += scores[t]; }
    float inv = 1.0f / sum;
#ifdef MQ_TRACE
    if (g_tr_p) for (int t = 0; t <= pos; t++) g_tr_p[t] = scores[t] * inv;
#endif
    memset(out, 0, hd * 4);
    for (int t = 0; t <= pos; t++) {
        const float *vt = vc + (size_t)t * kvd;
        float p = scores[t] * inv;
        for (int i = 0; i < hd; i++) out[i] += p * vt[i];
    }
}

float *mq_forward(MQModel *m, int token, int pos) {
    int d = m->dim, hd = m->head_dim, kvd = m->kv_heads * hd, group = m->heads / m->kv_heads;
    PROF_T(t);
    if (m->emb.bits == 4 && m->emb.rowscale) {       // W4R: строка эмбеддингов, масштаб на строку
        const uint8_t *er = m->emb.q4 + (size_t)token * m->emb.groups * 16;
        float sc = m->emb.s[token];
        for (int i = 0; i < d; i++) {
            int g = i >> 5, j = i & 31;
            uint8_t b = er[g * 16 + (j & 15)];
            m->x[i] = (float)((j < 16 ? (b & 15) : (b >> 4)) - 8) * sc;
        }
    } else if (m->emb.bits == 4) {                   // строка эмбеддингов из полубайтов
        const uint8_t *er = m->emb.q4 + (size_t)token * m->emb.groups * 16;
        const uint16_t *sr = m->emb.s4 + (size_t)token * m->emb.groups;
        for (int i = 0; i < d; i++) {
            int g = i >> 5, j = i & 31;
            uint8_t b = er[g * 16 + (j & 15)];
            m->x[i] = (float)((j < 16 ? (b & 15) : (b >> 4)) - 8) * h2f(sr[g]);
        }
    } else {
        const int8_t *er = m->emb.q + (size_t)token * d;
        for (int i = 0; i < d; i++) m->x[i] = er[i] * m->emb.s[token];
    }
    const float *cs = m->rope_cos + pos * (hd / 2), *sn = m->rope_sin + pos * (hd / 2);
    float scale = 1.0f / sqrtf((float)hd);

    for (int l = 0; l < m->layers; l++) {
        MQLayer *L = &m->L[l];
        TR_COPY(mq_trace->resid + (size_t)l * d, m->x, d);
        // --- attention (GQA + QK-norm + RoPE)
        rmsnorm(m->xn, m->x, L->in_norm, d, m->eps);
        PROF_ADD(MQP_OTHER, t);
        matmul_q8(m->q, &L->q, m->xn, m->xq);
        matmul_q8(m->k, &L->k, m->xn, m->xq);
        matmul_q8(m->v, &L->v, m->xn, m->xq);
        PROF_ADD(MQP_QKV, t);
        TR_COPY(mq_trace->v_out + (size_t)l * kvd, m->v, kvd);
        for (int h = 0; h < m->heads; h++) rmsnorm(m->q + h * hd, m->q + h * hd, L->q_norm, hd, m->eps);
        for (int h = 0; h < m->kv_heads; h++) rmsnorm(m->k + h * hd, m->k + h * hd, L->k_norm, hd, m->eps);
        rope(m->q, m->heads, hd, cs, sn);
        rope(m->k, m->kv_heads, hd, cs, sn);
        if (m->kv8) {
            size_t lp = (size_t)l * m->max_pos;                 // [layer][pos]
            float *ks = m->ks + lp * m->kv_heads, *vs = m->vs + lp * m->kv_heads;
            for (int g = 0; g < m->kv_heads; g++) {             // записать текущую позицию
                int8_t *kqg = m->kq_h[l * m->kv_heads + g], *vTg = m->vqT_h[l * m->kv_heads + g];
                ks[(size_t)pos * m->kv_heads + g] = quant_s8(kqg + (size_t)pos * hd, m->k + g * hd, hd);
                vs[(size_t)pos * m->kv_heads + g] = quant_s8(m->qq, m->v + g * hd, hd);
                for (int i = 0; i < hd; i++) vTg[(size_t)i * m->max_pos + pos] = m->qq[i];
            }
            for (int h = 0; h < m->heads; h++) {
                int g = h / group;
#ifdef MQ_TRACE
                g_tr_p = mq_trace ? mq_trace->attn_p + ((size_t)l * m->heads + h) * m->max_pos : NULL;
#endif
                attend_head_q8(m->att + h * hd, m->q + h * hd, m->kq_h[l * m->kv_heads + g], ks + g,
                               m->vqT_h[l * m->kv_heads + g], vs + g, m->qq, m->wq, m->scores, pos, hd,
                               hd /* шаг строк K внутри блока головы */, m->kv_heads, m->max_pos, scale);
            }
        } else {
            float *kc = m->kcache + ((size_t)l * m->max_pos) * kvd, *vc = m->vcache + ((size_t)l * m->max_pos) * kvd;
            memcpy(kc + (size_t)pos * kvd, m->k, kvd * 4);
            memcpy(vc + (size_t)pos * kvd, m->v, kvd * 4);
            for (int h = 0; h < m->heads; h++) {
#ifdef MQ_TRACE
                g_tr_p = mq_trace ? mq_trace->attn_p + ((size_t)l * m->heads + h) * m->max_pos : NULL;
#endif
                attend_head(m->att + h * hd, m->q + h * hd, kc + (h / group) * hd, vc + (h / group) * hd,
                            m->scores, pos, hd, kvd, scale);
            }
        }
        PROF_ADD(MQP_ATTN, t);
        TR_COPY(mq_trace->head_out + (size_t)l * m->heads * hd, m->att, m->heads * hd);
        matmul_q8(m->xn, &L->o, m->att, m->xq);
        PROF_ADD(MQP_O, t);
        TR_COPY(mq_trace->attn_out + (size_t)l * d, m->xn, d);
        for (int i = 0; i < d; i++) m->x[i] += m->xn[i];
        // --- MLP (SwiGLU)
        rmsnorm(m->xn, m->x, L->post_norm, d, m->eps);
        PROF_ADD(MQP_OTHER, t);
        matmul_q8(m->hb, &L->gate, m->xn, m->xq);
        matmul_q8(m->hb2, &L->up, m->xn, m->xq);
        PROF_ADD(MQP_MLP, t);
        for (int i = 0; i < m->inter; i++) m->hb[i] = silu(m->hb[i]) * m->hb2[i];
        TR_COPY(mq_trace->mlp_act + (size_t)l * m->inter, m->hb, m->inter);
        PROF_ADD(MQP_OTHER, t);
        matmul_q8(m->xn, &L->down, m->hb, m->xq);
        PROF_ADD(MQP_MLP, t);
        TR_COPY(mq_trace->mlp_out + (size_t)l * d, m->xn, d);
        for (int i = 0; i < d; i++) m->x[i] += m->xn[i];
    }
    TR_COPY(mq_trace->resid + (size_t)m->layers * d, m->x, d);
    rmsnorm(m->xn, m->x, m->final_norm, d, m->eps);
    TR_COPY(mq_trace->final_norm, m->xn, d);
    PROF_ADD(MQP_OTHER, t);
    matmul_q8(m->logits, m->has_head ? &m->head : &m->emb, m->xn, m->xq);   // tied: выходной слой = эмбеддинги
    PROF_ADD(MQP_HEAD, t);
    return m->logits;
}

#ifdef MQ_TRACE
void mq_dequant(const MQModel *m, int layer, int which, float *out) {
    const MQMat *W = which == 0 ? &m->L[layer].o : &m->L[layer].down;
    for (int r = 0; r < W->out; r++)
        for (int c = 0; c < W->in; c++) {
            float v;
            if (W->bits == 4) {
                const uint8_t *row = W->q4 + (size_t)r * W->groups * 16;
                int g = c >> 5, j = c & 31;
                uint8_t b = row[g * 16 + (j & 15)];
                int q = (j < 16 ? (b & 15) : (b >> 4)) - 8;
                v = q * (W->rowscale ? W->s[r] : h2f(W->s4[(size_t)r * W->groups + g]));
            } else v = W->q[(size_t)r * W->in + c] * W->s[r];
            out[(size_t)r * W->in + c] = v;
        }
}

void mq_project(MQModel *m, const float *x, float *out) {
    float *save = m->logits;
    rmsnorm(m->xn, x, m->final_norm, m->dim, m->eps);
    m->logits = out;
    matmul_q8(m->logits, m->has_head ? &m->head : &m->emb, m->xn, m->xq);
    m->logits = save;
}
#endif

// ---------------------------------------------------------------- сэмплинг
static uint32_t xorshift(uint64_t *s) { *s ^= *s >> 12; *s ^= *s << 25; *s ^= *s >> 27; return (uint32_t)((*s * 0x2545F4914F6CDD1DULL) >> 32); }

// Отсечение хвоста (см. microqwen.h). По умолчанию min-p 0.02 — как в студии; замер в micro-qwen3 (experiments/ngram):
// вдвое меньше историй с обломками слов на 4-битной модели при почти том же разнообразии.
float mq_min_p = 0.02f, mq_top_p = 1.0f;

int mq_sample(const MQModel *m, float temperature, int top_k, uint64_t *rng) {
    const float *lg = m->logits;
    int V = m->vocab, best = 0;
    for (int i = 1; i < V; i++) if (lg[i] > lg[best]) best = i;
    if (temperature <= 0) return best;
    if (top_k <= 0 || top_k > 64) top_k = 64;
    int idx[64]; float val[64]; int n = 0;
    for (int i = 0; i < V; i++) {          // простой отбор top-k вставками (k маленькое)
        float v = lg[i];
        if (n < top_k) { idx[n] = i; val[n] = v; n++; }
        else if (v > val[n - 1]) { idx[n - 1] = i; val[n - 1] = v; }
        else continue;
        for (int j = n - 1; j > 0 && val[j] > val[j - 1]; j--) {
            float tv = val[j]; val[j] = val[j - 1]; val[j - 1] = tv;
            int ti = idx[j]; idx[j] = idx[j - 1]; idx[j - 1] = ti;
        }
    }
    float sum = 0, p[64];
    for (int j = 0; j < n; j++) { p[j] = expf((val[j] - val[0]) / temperature); sum += p[j]; }
    if (mq_min_p > 0 || mq_top_p < 1) {            // p[0] = 1 — лучший кандидат; val отсортированы по убыванию
        int keep = n; float acc = 0;
        for (int j = 0; j < n; j++) {
            if (j > 0 && p[j] < mq_min_p) { keep = j; break; }
            acc += p[j];
            if (acc >= mq_top_p * sum) { keep = j + 1; break; }
        }
        n = keep; sum = 0; for (int j = 0; j < n; j++) sum += p[j];
    }
    float r = (xorshift(rng) / 4294967296.0f) * sum;
    for (int j = 0; j < n; j++) { r -= p[j]; if (r <= 0) return idx[j]; }
    return idx[n - 1];
}

// ---------------------------------------------------------------- токенизатор
const uint8_t *mq_token_bytes(const MQModel *m, int id, int *len) {
    if (id < 0 || id >= m->vocab) { *len = 0; return NULL; }
    *len = m->tok_len[id];
    return m->tok_bytes[id];
}

static int is_letter(unsigned char c) { return (c | 32) >= 'a' && (c | 32) <= 'z' ? 1 : c >= 0x80; }  // UTF-8 — как буквы
static int is_digit(unsigned char c) { return c >= '0' && c <= '9'; }
static int is_space(unsigned char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }
static int is_nl(unsigned char c) { return c == '\n' || c == '\r'; }

// Длина следующего куска по регулярке Qwen3 (ASCII-версия):
// (?i:'s|'t|'re|'ve|'m|'ll|'d) | [^\r\n\p{L}\p{N}]?\p{L}+ | \p{N} | ?[^\s\p{L}\p{N}]+[\r\n]* | \s*[\r\n]+ | \s+(?!\S) | \s+
static int pretok_len(const unsigned char *s, int n) {
    if (s[0] == '\'' && n > 1) {
        static const char *cs[] = {"re", "ve", "ll", "s", "t", "m", "d"};
        for (int k = 0; k < 7; k++) {
            int L = (int)strlen(cs[k]);
            if (n > L) {
                int ok = 1;
                for (int j = 0; j < L; j++) if ((s[1 + j] | 32) != cs[k][j]) ok = 0;
                if (ok) return 1 + L;
            }
        }
    }
    int i = 0;
    if (is_letter(s[0]) || (n > 1 && !is_letter(s[0]) && !is_digit(s[0]) && !is_nl(s[0]) && is_letter(s[1]))) {
        i = is_letter(s[0]) ? 0 : 1;
        while (i < n && is_letter(s[i])) i++;
        return i;
    }
    if (is_digit(s[0])) return 1;
    i = (s[0] == ' ') ? 1 : 0;
    if (i < n && !is_space(s[i]) && !is_letter(s[i]) && !is_digit(s[i])) {
        while (i < n && !is_space(s[i]) && !is_letter(s[i]) && !is_digit(s[i])) i++;
        while (i < n && is_nl(s[i])) i++;
        return i;
    }
    // пробельные: \s*[\r\n]+ — до последнего перевода строки в серии пробельных
    int j = 0, last_nl = -1;
    while (j < n && is_space(s[j])) { if (is_nl(s[j])) last_nl = j; j++; }
    if (last_nl >= 0) {
        int k = last_nl + 1;
        while (k < n && is_nl(s[k])) k++;
        return k;
    }
    if (j < n && j > 1) return j - 1;   // \s+(?!\S): оставить последний пробел следующему слову
    return j > 0 ? j : 1;
}

static int find_byte_token(const MQModel *m, unsigned char b) {
    for (int i = 0; i < m->vocab; i++) if (m->tok_len[i] == 1 && m->tok_bytes[i][0] == b) return i;
    return -1;
}

// Служебные токены чата Qwen: id задаются порядком SPECIAL_TOKENS в prepare_data.py (0, 1, 2).
// Как в HF tokenizers, в тексте они распознаются целиком и не проходят через BPE.
static const char *const SPECIAL[] = {"<|endoftext|>", "<|im_start|>", "<|im_end|>"};

static int encode_plain(const MQModel *m, const unsigned char *s, int n, int *out, int max_out);

int mq_encode(const MQModel *m, const char *text, int *out, int max_out) {
    const unsigned char *s = (const unsigned char *)text;
    int n = (int)strlen(text), nout = 0, start = 0;
    for (int pos = 0; pos < n; pos++) {
        if (s[pos] != '<' || pos + 1 >= n || s[pos + 1] != '|') continue;
        for (int k = 0; k < 3; k++) {
            int L = (int)strlen(SPECIAL[k]);
            if (pos + L <= n && !memcmp(s + pos, SPECIAL[k], L)) {
                nout += encode_plain(m, s + start, pos - start, out + nout, max_out - nout);
                if (nout < max_out) out[nout++] = k;
                start = pos + L;
                pos = start - 1;
                break;
            }
        }
    }
    return nout + encode_plain(m, s + start, n - start, out + nout, max_out - nout);
}

static int encode_plain(const MQModel *m, const unsigned char *s, int n, int *out, int max_out) {
    int nout = 0;
    int buf[512];
    for (int pos = 0; pos < n;) {
        int L = pretok_len(s + pos, n - pos);
        int nb = 0;
        for (int i = 0; i < L && nb < 512; i++) buf[nb++] = find_byte_token(m, s[pos + i]);
        // BPE: многократно сливаем пару с наименьшим рангом
        for (;;) {
            int best_rank = m->n_merges, best_j = -1;
            for (int j = 0; j + 1 < nb; j++)
                for (int r = 0; r < best_rank; r++)
                    if (m->merges[3 * r] == buf[j] && m->merges[3 * r + 1] == buf[j + 1]) { best_rank = r; best_j = j; break; }
            if (best_j < 0) break;
            buf[best_j] = m->merges[3 * best_rank + 2];
            memmove(buf + best_j + 1, buf + best_j + 2, (nb - best_j - 2) * sizeof(int));
            nb--;
        }
        for (int i = 0; i < nb && nout < max_out; i++) out[nout++] = buf[i];
        pos += L;
    }
    return nout;
}

// ---------------------------------------------------------------- доплата заказанным словам
static int is_word_char(unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_'; }
static unsigned char lower(unsigned char c) { return (c >= 'A' && c <= 'Z') ? c + 32 : c; }

// как re.search(rf"\b{word}", text, re.I): слово как начало слова (cat -> cats), без учёта регистра
static int word_in(const char *text, int tl, const char *w, int wl) {
    for (int i = 0; i + wl <= tl; i++) {
        if (i > 0 && is_word_char((unsigned char)text[i - 1])) continue;
        int k = 0;
        while (k < wl && lower((unsigned char)text[i + k]) == lower((unsigned char)w[k])) k++;
        if (k == wl) return 1;
    }
    return 0;
}

int mq_wb_init(MQWordBias *wb, const MQModel *m, const char *words, float base, float tau, float start) {
    memset(wb, 0, sizeof *wb);
    wb->base = base; wb->tau = tau; wb->used_prev = -1;
    const char *p = words;
    while (*p && wb->n < MQ_WB_MAXW) {
        while (*p == ',' || *p == ' ') p++;
        int l = 0;
        char *w = wb->word[wb->n];
        while (*p && *p != ',' && *p != ' ' && l < 23) {
            char c = (char)lower((unsigned char)*p++);
            if ((c >= 'a' && c <= 'z') || c == '-' || c == '\'') w[l++] = c;
        }
        while (*p && *p != ',' && *p != ' ') p++;
        if (!l) continue;
        w[l] = 0; wb->wlen[wb->n] = l;
        char sp[26] = " "; memcpy(sp + 1, w, l + 1);
        wb->slen[wb->n] = mq_encode(m, sp, wb->seq[wb->n], MQ_WB_MAXTOK);
        if (wb->slen[wb->n] > 0) wb->n++;
    }
    wb->u0 = start * (MQ_WB_MAXW - wb->n);
    return wb->n;
}

int mq_wb_used(const MQWordBias *wb, const char *text, int text_len) {
    int u = 0;
    for (int i = 0; i < wb->n; i++) u += word_in(text, text_len, wb->word[i], wb->wlen[i]);
    return u;
}

int mq_wb_step(MQWordBias *wb, const char *text, int text_len, const int *gen, int ngen, int *tok, float *bias) {
    if (!wb->n || wb->base == 0) return 0;
    int left[MQ_WB_MAXW], nl = 0;
    for (int i = 0; i < wb->n; i++) if (!word_in(text, text_len, wb->word[i], wb->wlen[i])) left[nl++] = i;
    int used = wb->n - nl;
    float b = wb->base * (used + wb->u0 + 1);
    if (used != wb->used_prev) { wb->used_prev = used; wb->since = ngen; }   // новое слово — отсчёт заново
    if (wb->tau > 0) b *= 1 + (ngen - wb->since) / wb->tau;
    for (int q = 0; q < nl; q++) {
        int i = left[q], j = 0;                   // сколько первых кусков слова уже стоят в конце текста
        for (int k = (wb->slen[i] - 1 < ngen ? wb->slen[i] - 1 : ngen); k > 0; k--)
            if (!memcmp(gen + ngen - k, wb->seq[i], k * sizeof(int))) { j = k; break; }
        tok[q] = wb->seq[i][j]; bias[q] = b;
    }
    return nl;
}

// ---------------------------------------------------------------- штраф за зацикливание
static int tok_breaker(const MQModel *m, int id) {
    int l; const uint8_t *b = mq_token_bytes(m, id, &l);
    for (int i = 0; i < l; i++) {
        uint8_t c = b[i];
        if (c == '.' || c == ',' || c == '!' || c == '?' || c == ';' || c == ':' || c == '"' || c == '\n') return 1;
    }
    return 0;
}
static int tok_word_start(const MQModel *m, int id) { int l; const uint8_t *b = mq_token_bytes(m, id, &l); return l > 0 && b[0] == ' '; }
static int tok_joiner(const MQModel *m, int id) {
    int l; const uint8_t *b = mq_token_bytes(m, id, &l);
    return (l == 4 && !memcmp(b, " and", 4)) || (l == 3 && !memcmp(b, " or", 3));
}
static int lp_add(int *tok, float *pen, int n, int max_out, int t, float v) {
    for (int i = 0; i < n; i++) if (tok[i] == t) { pen[i] += v; return n; }
    if (n < max_out) { tok[n] = t; pen[n] = v; n++; }
    return n;
}

int mq_loop_step(const MQModel *m, const int *gen, int n, float imm, float mult, float base, int window,
                 int *tok, float *pen, int max_out) {
    int no = 0;
    if (!n) return 0;
    if (imm != 0) {
        if (tok_word_start(m, gen[n - 1]) && !tok_breaker(m, gen[n - 1])) no = lp_add(tok, pen, no, max_out, gen[n - 1], -imm);
        if (n >= 2 && tok_joiner(m, gen[n - 1]) && !tok_breaker(m, gen[n - 2])) no = lp_add(tok, pen, no, max_out, gen[n - 2], -imm);
        if (n >= 3 && tok_joiner(m, gen[n - 2]) && tok_word_start(m, gen[n - 3]) && !tok_breaker(m, gen[n - 3])
            && tok_word_start(m, gen[n - 1]) && !tok_breaker(m, gen[n - 1]) && gen[n - 1] != gen[n - 3])
            no = lp_add(tok, pen, no, max_out, gen[n - 3], -imm);
    }
    if (mult != 0 && n >= 3) {
        int st[64]; float sp[64]; int ns = 0;          // самый сильный штраф на токен
        int lo = n - window > 0 ? n - window : 0;
        for (int j = lo + 2; j < n; j++) {
            int k = 0;
            while (k < MQ_LP_MAXK && j - 1 - k >= lo && gen[j - 1 - k] == gen[n - 1 - k]
                   && !tok_breaker(m, gen[n - 1 - k]) && n - 1 - k > j - 1) k++;
            if (k < 2) continue;
            float v = mult * powf(base, (float)(k - 2));
            int q = 0;
            while (q < ns && st[q] != gen[j]) q++;
            if (q == ns) { if (ns == 64) continue; st[ns] = gen[j]; sp[ns] = v; ns++; }
            else if (v > sp[q]) sp[q] = v;
        }
        for (int q = 0; q < ns; q++) no = lp_add(tok, pen, no, max_out, st[q], -sp[q]);
    }
    return no;
}

// ---------------------------------------------------------------- автомат для заказанных слов
int mq_tok_letter(const MQModel *m, int id) {
    int l; const uint8_t *b = mq_token_bytes(m, id, &l);
    return l > 0 && ((b[0] >= 'a' && b[0] <= 'z') || (b[0] >= 'A' && b[0] <= 'Z'));
}

static void fsm_add(MQWordFSM *f, const MQModel *m, const char *text, int word) {
    if (f->nf >= MQ_FSM_MAXF) return;
    int n = mq_encode(m, text, f->fseq[f->nf], MQ_WB_MAXTOK);
#ifdef MQ_TRACE
    if (n > 0) f->fword[f->nf] = word;
#else
    (void)word;
#endif
    if (n > 0) f->flen[f->nf++] = n;
}

// Нормальные формы слова по правилам английского: само слово, -s/-es/-ies, -ed/-d/-ied, -ing/-ying с отбрасыванием
// немой e. Согласная удваивается только в односложном слове вида согласная–гласная–согласная (run → running,
// stop → stopped), но не в dragon. Раньше окончания клеились к любому слову подряд, и FSM разрешал «dareing».
static int mq_vowel(char c) { return c && strchr("aeiou", c) != NULL; }
static void mq_word_forms(const char *w, int wl, char forms[10][32], int *nfm) {
    int n = 0;
    snprintf(forms[n++], 32, "%s", w);
    if (wl < 2) { *nfm = n; return; }
    char z = w[wl - 1], y = w[wl - 2];
    // окончания существительных — только множественное (invitation → invitations, не «invitationing»);
    // окончания прилагательных — никаких форм (graceful, honest, modest: не «honesting»)
    static const char *noun_end[] = {"tion", "sion", "ment", "ness", "ity", "ship", "hood", "ism", NULL};
    static const char *adj_end[] = {"ful", "ous", "ive", "less", "able", "ible", "ish", NULL};
    int nounish = 0, adjish = 0;
    for (int k = 0; noun_end[k]; k++) { int sl = strlen(noun_end[k]); nounish |= wl > sl + 1 && !strcmp(w + wl - sl, noun_end[k]); }
    for (int k = 0; adj_end[k]; k++) { int sl = strlen(adj_end[k]); adjish |= wl > sl + 1 && !strcmp(w + wl - sl, adj_end[k]); }
    int groups = 0;                                   // число групп гласных ≈ число слогов
    for (int k = 0; k < wl; k++) if (mq_vowel(w[k]) && (k == 0 || !mq_vowel(w[k - 1]))) groups++;
    int cvc = wl >= 3 && groups == 1 && !mq_vowel(z) && !strchr("wxy", z) && mq_vowel(y) && !mq_vowel(w[wl - 3]);
    if (wl > 4 && groups >= 2 && !strcmp(w + wl - 3, "est")) nounish = 1;   // honest, modest, forest: только -s (но не rest, nest)
    if (adjish) { *nfm = n; return; }
    int cons_y = z == 'y' && !mq_vowel(y);
    int sib = strchr("sxz", z) || (z == 'h' && (y == 'c' || y == 's'));
    // -s / -es / -ies
    if (cons_y) snprintf(forms[n++], 32, "%.*sies", wl - 1, w);
    else snprintf(forms[n++], 32, "%s%s", w, sib ? "es" : "s");
    if (nounish) { *nfm = n; return; }
    // -ed / -d / -ied; у частых неправильных глаголов прошедшее не продолжает основу (ran, swam, saw) — формы нет
    static const char *irr[] = {"be", "begin", "bite", "blow", "break", "bring", "build", "buy", "catch", "choose",
        "come", "dig", "do", "draw", "drink", "drive", "eat", "fall", "feel", "fight", "find", "fly", "forget", "freeze",
        "get", "give", "go", "grow", "have", "hear", "hide", "hold", "keep", "know", "leave", "lose", "make", "meet",
        "ride", "ring", "rise", "run", "say", "see", "sell", "send", "shake", "shine", "sing", "sink", "sit", "sleep",
        "speak", "spin", "stand", "steal", "swim", "take", "teach", "tell", "think", "throw", "wake", "wear", "win",
        "write", NULL};
    int irregular = 0;
    for (int k = 0; irr[k]; k++) irregular |= !strcmp(w, irr[k]);
    if (irregular) ;
    else if (z == 'e') snprintf(forms[n++], 32, "%sd", w);
    else if (cons_y) snprintf(forms[n++], 32, "%.*sied", wl - 1, w);
    else if (cvc) snprintf(forms[n++], 32, "%s%ced", w, z);
    else snprintf(forms[n++], 32, "%sed", w);
    // -ing
    if (z == 'e' && y == 'i') snprintf(forms[n++], 32, "%.*sying", wl - 2, w);
    else if (z == 'e' && !strchr("eoy", y)) snprintf(forms[n++], 32, "%.*sing", wl - 1, w);
    else if (cvc) snprintf(forms[n++], 32, "%s%cing", w, z);
    else snprintf(forms[n++], 32, "%sing", w);
    *nfm = n;
}

int mq_fsm_init(MQWordFSM *f, const MQModel *m, const MQWordBias *wb, int lock, float start_bonus) {
    memset(f, 0, sizeof *f);
    f->lock = lock; f->start_bonus = start_bonus;
    for (int i = 0; i < wb->n; i++) {
        const char *w = wb->word[i]; int wl = wb->wlen[i];
        char forms[10][32]; int nfm = 0;
        mq_word_forms(w, wl, forms, &nfm);
        for (int a = 0; a < nfm; a++) {
            int dup = 0;
            for (int b = 0; b < a; b++) dup |= !strcmp(forms[a], forms[b]);
            if (dup) continue;
            char cap[32]; strcpy(cap, forms[a]); if (cap[0] >= 'a' && cap[0] <= 'z') cap[0] -= 32;
            const char *v[2] = {forms[a], cap};
            for (int c = 0; c < 2; c++) {
                char sp[34]; snprintf(sp, sizeof sp, " %s", v[c]);
                fsm_add(f, m, sp, i);
                fsm_add(f, m, v[c], i);
            }
        }
    }
    return f->nf;
}

int mq_fsm_allowed(const MQWordFSM *f, int form, int tok) {
    int L = f->flen[form];
    for (int q = 0; q < f->nf; q++)
        if (f->flen[q] > L && !memcmp(f->fseq[q], f->fseq[form], L * sizeof(int)) && f->fseq[q][L] == tok) return 1;
    return 0;
}

int mq_fsm_next(const MQWordFSM *f, int form, int *out, int max_out) {
    int L = f->flen[form], n = 0;
    for (int q = 0; q < f->nf; q++) {
        if (f->flen[q] <= L || memcmp(f->fseq[q], f->fseq[form], L * sizeof(int))) continue;
        int t = f->fseq[q][L], dup = 0;
        for (int i = 0; i < n; i++) dup |= out[i] == t;
        if (!dup && n < max_out) out[n++] = t;
    }
    return n;
}

int mq_fsm_step(MQWordFSM *f, MQWordBias *wb, const MQModel *m, const char *text, int tl, const int *gen, int n,
                int *tok, float *val, int *nb, int max_out, int *form) {
    (void)m;
    *nb = 0; *form = -1;
    for (int i = 0; i < wb->n; i++) {
        const int *seq = wb->seq[i]; int sl = wb->slen[i];
        for (int k = (sl - 1 < n ? sl - 1 : n); k > 0; k--) {
            if (memcmp(gen + n - k, seq, k * sizeof(int))) continue;
            if (k >= f->lock) return seq[k];
            int c = mq_wb_step(wb, text, tl, gen, n, tok, val);
            int q = 0;
            while (q < c && tok[q] != seq[k]) q++;
            if (q < c) val[q] += f->start_bonus;
            else if (c < max_out) { tok[c] = seq[k]; val[c] = f->start_bonus; c++; }
            *nb = c;
            return -1;
        }
    }
    *nb = mq_wb_step(wb, text, tl, gen, n, tok, val);
    for (int q = 0; q < f->nf; q++) {
        int L = f->flen[q];
        if (n >= L && !memcmp(gen + n - L, f->fseq[q], L * sizeof(int))) { *form = q; break; }
    }
    return -1;
}
