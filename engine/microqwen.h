// Copy of esp/microqwen.h from micro-qwen3 (commit b6c7957) — the same C engine as the ESP32-S3 firmware.
// Update with scripts/sync-engine.sh; do not edit here.
// micro-qwen3: инференс архитектуры Qwen3 на чистом C (Mac и ESP32-S3).
// Веса int8 с масштабом на строку, активации квантуются в int8 на вход каждого матричного умножения
// (W8A8 — формат, который нативно умеет векторный блок ESP32-S3). Всё остальное — float32.
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef MQ_ESP32                // ESP32-S3: выровненные буферы активаций — во внутренней SRAM
#include "esp_heap_caps.h"
#define MQ_MALLOC_A16(n) heap_caps_aligned_alloc(16, (n), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)
#define MQ_MALLOC_A16_EXT(n) heap_caps_aligned_alloc(16, (n), MALLOC_CAP_SPIRAM)
#endif
#ifndef MQ_MALLOC_A16_EXT      // выровненный буфер во внешней памяти (KV-cache, если внутренней не хватает)
#define MQ_MALLOC_A16_EXT(n) MQ_MALLOC_A16(n)
#endif
#ifndef MQ_MALLOC
#include <stdlib.h>
#define MQ_MALLOC(n) malloc(n)
#define MQ_FREE(p) free(p)
#endif
#ifndef MQ_MALLOC_A16          // буфер, выровненный на 16 байт (векторные загрузки PIE на ESP32-S3)
#define MQ_MALLOC_A16(n) MQ_MALLOC(n)
#endif

// y = W x, W: [out][in]. W8: q — int8 [out][in], s — f32 [out]. W4: q4 — [out][groups][16] полубайтов
// (u = q + 8, младшие — веса 0..15 группы, старшие — 16..31), s4 — f16 [out][groups], группа = 32 входа.
// W4R (rowscale=1): q4 — та же упаковка полубайтов, но масштаб один на строку — s (f32 [out]).
typedef struct { const int8_t *q; const float *s; const uint8_t *q4; const uint16_t *s4; int out, in, groups, bits, rowscale; } MQMat;

typedef struct {
    const float *in_norm, *post_norm, *q_norm, *k_norm;
    MQMat q, k, v, o, gate, up, down;
} MQLayer;

typedef struct {
    int vocab, dim, inter, layers, heads, kv_heads, head_dim, max_pos;
    float rope_theta, eps;
    MQMat emb;                 // таблица эмбеддингов; если has_head == 0 — и выходной слой (tied)
    MQMat head; int has_head;  // отдельный выходной слой (version 4)
    const float *final_norm;
    MQLayer *L;
    // токенизатор
    const uint8_t **tok_bytes; uint8_t *tok_len;
    int n_merges; uint16_t *merges;   // тройки (a, b, слитый) по рангу
    // рабочие буферы
    float *x, *xn, *q, *k, *v, *att, *hb, *hb2, *logits, *scores, *rope_cos, *rope_sin;
    int8_t *xq;
    int32_t *gsum;             // W4: суммы квантованного входа по группам (поправка на нулевую точку 8)
    int bits;                  // 8 или 4
    int rowscale;              // W4R: масштаб на строку
    float *kcache, *vcache;    // float32: [layers][max_pos][kv_heads*head_dim]
    // int8 KV-cache (mq_kv_int8 = 1): K — [layers][max_pos][kvd], V — транспонирован [layers][kv_heads][head_dim][max_pos]
    int kv8;
    int8_t *qq, *wq;
    // KV-cache по блоку на (слой, kv-голову): K — [pos][head_dim], V — транспонирован [head_dim][pos].
    // Мелкие блоки (~16 КБ) легче разместить во фрагментированной внутренней SRAM.
    int8_t *kq_h[64], *vqT_h[64];
    int kv_blocks, kv_blocks_internal;
    float *ks, *vs;            // масштабы: [layers][max_pos][kv_heads]
} MQModel;

// Загрузка из буфера (файл целиком в памяти или раздел flash, отображённый в адресное пространство).
// Веса не копируются: указатели смотрят прямо в buf. Возвращает 0 при успехе.
int mq_load(MQModel *m, const uint8_t *buf, size_t len);
void mq_free(MQModel *m);

// Один шаг: токен на позиции pos -> логиты в m->logits[vocab].
float *mq_forward(MQModel *m, int token, int pos);

// Токенизатор (pre-tokenization как у Qwen3 для ASCII + BPE по слияниям). Возвращает число токенов.
int mq_encode(const MQModel *m, const char *text, int *out, int max_out);
// Байты токена (для вывода). Спецтокены — пустая строка.
const uint8_t *mq_token_bytes(const MQModel *m, int id, int *len);

// «Доплата» заказанным словам (каскад + нарастание по времени), как micro_qwen3/word_bias.py, mode="escalate",
// multi_token=True: неиспользованное слово получает base·(u+1)·(1 + t/tau) к логиту своего (очередного) куска,
// u — сколько заказанных слов уже есть в тексте, t — токенов с появления последнего (tau = 0 — без нарастания).
// start: доля старта каскада от полного заказа — u стартует с start·(MQ_WB_MAXW − n). 1 — как у полного заказа,
// 0.5 — правило платы u0 = (3 − n)/2 (одно слово 2·base, два — 1.5·base), 0 — без поправки.
#define MQ_WB_MAXW 3
#define MQ_WB_MAXTOK 12
typedef struct {
    int n, used_prev, since;
    float base, tau, u0;
    char word[MQ_WB_MAXW][24]; int wlen[MQ_WB_MAXW];
    int seq[MQ_WB_MAXW][MQ_WB_MAXTOK]; int slen[MQ_WB_MAXW];
} MQWordBias;
// words — через запятую или пробел, до 3 слов (латиница, дефис, апостроф). Возвращает число слов.
int mq_wb_init(MQWordBias *wb, const MQModel *m, const char *words, float base, float tau, float start);
// text/text_len — уже сгенерированный текст (байты), gen/ngen — его токены. Пишет пары (токен, доплата),
// возвращает их число (≤ MQ_WB_MAXW). Совпадающие токены не склеивает — вызывающий просто прибавляет к логитам.
int mq_wb_step(MQWordBias *wb, const char *text, int text_len, const int *gen, int ngen, int *tok, float *bias);
// Сколько заказанных слов уже есть в тексте (для статистики).
int mq_wb_used(const MQWordBias *wb, const char *text, int text_len);

// Трасса для визуализации (только сборки с -DMQ_TRACE, на плате этого кода нет): если mq_trace != NULL,
// mq_forward копирует в него промежуточные значения текущего шага.
#ifdef MQ_TRACE
typedef struct {
    float *resid;      // [layers + 1][dim]: остаточный поток перед каждым слоем и после последнего
    float *attn_out;   // [layers][dim]: вклад attention (после o-проекции)
    float *mlp_act;    // [layers][inter]: silu(gate) · up — «нейроны» MLP
    float *mlp_out;    // [layers][dim]: вклад MLP (после down-проекции)
    float *attn_p;     // [layers][heads][max_pos]: веса внимания текущего токена на позиции 0..pos
    float *final_norm; // [dim]: вход выходного слоя (после финального RMSNorm)
    float *head_out;   // [layers][heads*head_dim]: выходы голов внимания (до o-проекции)
    float *v_out;      // [layers][kv_heads*head_dim]: вектор value текущего токена (то, что из него потом читают)
} MQTrace;
extern MQTrace *mq_trace;
// Logit lens: финальный RMSNorm + выходной слой к произвольному вектору остаточного потока (out — vocab чисел).
void mq_project(MQModel *m, const float *x, float *out);
// Веса слоя в float (для линий потока в визуализации): which 0 — o_proj [dim × heads*head_dim], 1 — down [dim × inter].
void mq_dequant(const MQModel *m, int layer, int which, float *out);
#endif

// Автомат для заказанных слов, как micro_qwen3/word_fsm.py: мягко — КОГДА вставить слово (WordBias), жёстко — КАК
// его написать. Совпало k ≥ lock первых кусков слова — следующий кусок принудительно; k = 1 — доплата start_bonus
// второму куску; текст кончается нормальной формой слова (+s/es/ed/d/ing, с заглавной, без пробела) — запрещены
// куски, продолжающие слово буквами, кроме ведущих к другой нормальной форме («warnerer», «examineineine» нельзя).
#define MQ_FSM_MAXF 120
typedef struct {
    int nf, lock; float start_bonus;
    int flen[MQ_FSM_MAXF]; int fseq[MQ_FSM_MAXF][MQ_WB_MAXTOK];
#ifdef MQ_TRACE
    int fword[MQ_FSM_MAXF];   // к какому заказанному слову относится форма (только для визуализации)
#endif
} MQWordFSM;
int mq_fsm_init(MQWordFSM *f, const MQModel *m, const MQWordBias *wb, int lock, float start_bonus);
// Возвращает принудительный токен (≥ 0) — тогда больше ничего не нужно, или −1: тогда tok/val/*nb — доплаты (уже
// с WordBias), а *form — номер формы слова в конце текста (≥ 0 — применить mq_fsm_allowed ко всем «буквенным» кускам).
int mq_fsm_step(MQWordFSM *f, MQWordBias *wb, const MQModel *m, const char *text, int tl, const int *gen, int ng,
                int *tok, float *val, int *nb, int max_out, int *form);
int mq_fsm_allowed(const MQWordFSM *f, int form, int tok);   // может ли tok идти после формы form
// Все токены, которые могут идти после формы form (продолжения к другим нормальным формам); их немного.
int mq_fsm_next(const MQWordFSM *f, int form, int *out, int max_out);
int mq_tok_letter(const MQModel *m, int id);                 // кусок начинается с буквы (продолжает слово)

// Штраф за зацикливание, как micro_qwen3/loop_penalty.py: немедленный повтор внутри фразы («hot hot», «tall and tall»,
// «very tall and very tall») -> −imm; повтор последовательности k ≥ 2 токенов в окне window (DRY) -> −mult·base^(k−2).
// Знаки препинания и перевод строки обрывают совпадения. Пишет пары (токен, штраф) — уникальные токены, ≤ max_out.
#define MQ_LP_MAXK 8
int mq_loop_step(const MQModel *m, const int *gen, int ngen, float imm, float mult, float base, int window,
                 int *tok, float *pen, int max_out);

// Параллельное выполнение матричного умножения (на ESP32-S3 — второе ядро). Если NULL — последовательно.
// fn считает строки [r0, r1) выхода y по уже квантованному входу xq с масштабом sx.
typedef void (*MQRowsFn)(float *y, const MQMat *W, const int8_t *xq, float sx, int r0, int r1);
extern void (*mq_parallel)(MQRowsFn fn, float *y, const MQMat *W, const int8_t *xq, float sx);
// Векторное ядро PIE (только при сборке с MQ_PIE): можно выключить на лету для сравнения.
extern int mq_pie_enabled;
// KV-cache в int8 (по умолчанию) или float32 — задаётся ДО mq_load.
extern int mq_kv_int8;
// KV-cache во внешней памяти (PSRAM) вместо внутренней SRAM — задаётся ДО mq_load.
extern int mq_kv_in_psram;
extern uint32_t mq_pie_fallbacks;   // сколько вызовов ушло в скаляр из-за выравнивания/длины (должно быть 0)
int32_t mq_dot_s8(const int8_t *w, const int8_t *x, int n);
int32_t mq_dot_u4(const uint8_t *w, const int8_t *x);
int32_t mq_dot_u4row(const uint8_t *w, const int8_t *x, int groups);   // W4R: вся строка, для самотеста   // W4: группа 32 (16 байт полубайтов), для самотеста

// Профилирование (только при сборке с MQ_PROFILE): микросекунды по статьям, копятся между вызовами.
enum { MQP_QKV, MQP_ATTN, MQP_O, MQP_MLP, MQP_HEAD, MQP_OTHER, MQP_N };
extern uint64_t mq_prof_us[MQP_N];
extern uint64_t (*mq_now_us)(void);

// Выбор следующего токена: temperature <= 0 — argmax; иначе top-k сэмплинг. rng — состояние xorshift.
int mq_sample(const MQModel *m, float temperature, int top_k, uint64_t *rng);
