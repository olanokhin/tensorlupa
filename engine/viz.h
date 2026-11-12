// Движок визуализации micro-qwen3: тот же microqwen.c, что на ESP32-S3, плюс запись всего, что происходит на шаге.
// Один шаг = входной токен на позиции pos -> проход модели -> логиты -> (для шагов генерации) доплата, автомат,
// маска, сэмплинг — ровно как в прошивке (esp/idf/main/main.c, generate). Формат трассы описан в viz/TRACE.md.
#pragma once
#include <stdint.h>

#define VIZ_MAX_WORDS 3

// Загрузка модели (байты файла .bin, как на плате). 0 — успех.
int viz_load(const uint8_t *buf, int len);

// Настройки декодирования (действуют с следующего viz_begin).
void viz_settings(float temperature, int top_k, uint32_t seed, float wb_base, float wb_tau, float wb_start,
                  int fsm_on, int fsm_lock, float fsm_bonus, float loop_imm, float loop_mult, int max_new);

// Новый прогон: prompt — текст для модели (уже в чат-формате, если нужен), words — заказанные слова через запятую
// или пробел ("" — без заказа). Возвращает число токенов промпта.
int viz_begin(const char *prompt, const char *words);

// Режим «на том же тексте»: после viz_begin задать токены ответа — шаги генерации считают всё как обычно (доплата,
// автомат, маска, вероятности), но вместо сэмплинга берут следующий заданный токен. n = 0 — обычный режим.
void viz_force(const int *answer, int n);

// Один шаг. Возвращает: 1 — шаг промпта (следующий токен известен), 2 — шаг генерации, 0 — прогон закончен
// (стоп-токен или лимит; трасса последнего шага при этом всё равно записана, если был проход модели), -1 — ошибка.
int viz_step(void);

// Logit lens: x — вектор остаточного потока (dim чисел) -> логиты (vocab чисел) в буфер viz_lens_out().
void viz_lens(const float *x);

// --- чтение состояния (указатели живут до следующего viz_load)
int viz_info(int what);              // 0 vocab, 1 dim, 2 inter, 3 layers, 4 heads, 5 kv_heads, 6 head_dim, 7 max_pos
const uint8_t *viz_token_bytes(int id, int *len);
int viz_token_len(int id);
const uint8_t *viz_token_ptr(int id);

// трасса шага: остаточный поток, вклады слоёв, нейроны MLP, внимание, вход выходного слоя
float *viz_tr_resid(void);           // [layers+1][dim]
float *viz_tr_attn_out(void);        // [layers][dim]
float *viz_tr_mlp_act(void);         // [layers][inter]
float *viz_tr_mlp_out(void);         // [layers][dim]
float *viz_tr_attn_p(void);          // [layers][heads][max_pos], на позициях 0..pos
float *viz_tr_final_norm(void);      // [dim]
float *viz_tr_head_out(void);        // [layers][heads*head_dim]
float *viz_tr_v_out(void);           // [layers][kv_heads*head_dim]: value текущего токена
// Веса слоя в float: which 0 — o_proj [dim × heads*head_dim], 1 — down [dim × inter]; буфер живёт до следующего вызова.
float *viz_weights(int layer, int which);

// логиты по этапам
float *viz_logits_raw(void);         // [vocab] выход модели
float *viz_logits_final(void);       // [vocab] после доплаты, маски и штрафа (замаскированные = -1e30)
float *viz_lens_out(void);           // [vocab]

// числа шага (индексы в viz_step_int / viz_step_float)
//  int: 0 pos, 1 input token, 2 output token, 3 kind (1 prompt, 2 gen), 4 forced token (-1), 5 form (-1),
//       6 n bias pairs, 7 n loop pairs, 8 n allowed after form, 9 n top-k, 10 gen index (номер токена ответа),
//       11 words, 12 words used
//  float: 0 sample r (доля суммы, куда попал бросок), 1 entropy (бит) распределения после температуры и top-k
int viz_step_int(int i);
float viz_step_float(int i);
int *viz_bias_tok(void);   float *viz_bias_val(void);    // доплата (уже с бонусом автомата)
int *viz_loop_tok(void);   float *viz_loop_val(void);    // штраф за циклы (если включён)
int *viz_allowed(void);                                  // разрешённые продолжения после формы слова
int *viz_topk_tok(void);   float *viz_topk_p(void);      // кандидаты сэмплинга и их вероятности

// состояние заказанных слов: для слова i (0..words-1)
//  int: 0 state (0 ждём, 1 начали k=1, 2 собираем k>=lock, 3 форма только что закончилась, 4 уже использовано),
//       1 k (совпавших кусков), 2 кусков в слове, 3 использовано (0/1)
int viz_word_int(int i, int what);
const char *viz_word_text(int i);
//  доплата сейчас: base, u0, u (использовано слов), t (токенов с последнего слова), tau
float viz_wb(int what);
