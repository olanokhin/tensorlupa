// Глоссарий терминов: единственный источник. Из него собираются
//   · подсказки терминов в студии (ключи gl.<id> словарей, см. конец файла);
//   · страница-словарик в Docs и таблица i18n/GLOSSARY.md (scripts/glossary.mjs);
//   · проверка подписей (тот же скрипт).
// Правило: в подписях термин стоит так, как человек встретит его в статьях, коде и документации, а перевод и объяснение
// в одну фразу он получает при наведении и на странице-словарике.
// Группы (group):
//   keep      — в подписях как в индустрии, латиницей на всех языках (attention, top-k, logit bias, RMSNorm)
//   calque    — в подписях устоявшееся слово языка (токен, логиты, слой)
//   translate — в подписях перевод (остаточный поток)
// Группа решает только, что стоит в подписи. Подсказка у всех одного вида, порядок всегда один:
// «English term · слово на языке читателя. Объяснение.» — «Attention · внимание. …», «Token · токен. …»,
// «Residual stream · остаточный поток. …». (Пробовали ставить первым то, что в подписи: порядок языков скакал и сбивал.)
// Поля термина: id (ключ подсказки gl.<id>), term (как в индустрии), group, short (для тесных подписей), slug (статья Docs),
// source (откуда термин, для переводчика), а для каждого языка: word (перевод слова), label (как пишем в подписях, если не term
// и не word), tip (объяснение в одну фразу, без самого термина в начале), avoid (формы, которых в подписях быть не должно).
// Новый язык: добавить код в LANGS и заполнить у каждого термина word и tip (label и avoid по необходимости).
(function (root) {
  const LANGS = ['en', 'ru'];
  const T = [
    // --- основы
    { id: 'languageModel', term: 'language model', group: 'translate', slug: 'language-model',
      en: { tip: 'A language model predicts the next piece of text. It reads what is written so far, scores every possible next token, picks one, adds it and repeats.' },
      ru: { word: 'языковая модель', tip: 'Предсказывает следующий кусочек текста: читает написанное, оценивает каждый возможный следующий токен, выбирает один, дописывает его и повторяет.' } },
    { id: 'token', term: 'token', group: 'calque', slug: 'token',
      en: { tip: 'A token is a piece of text the model reads and writes: a whole word, part of a word or a sign. micro-qwen3 knows 4,096 of them.' },
      ru: { word: 'токен', tip: 'Кусочек текста, который модель читает и пишет: целое слово, часть слова или знак. micro-qwen3 знает 4096 токенов.' } },
    { id: 'prompt', term: 'prompt', group: 'calque', slug: 'prompt',
      en: { tip: 'The prompt is everything the model reads before it answers: here, your request wrapped in chat markers. The completion is what it writes after.' },
      ru: { word: 'промпт', tip: 'Всё, что модель читает до ответа. Здесь это ваша просьба в служебных метках чата. Ответ (completion) модель пишет после него.' } },
    { id: 'specialTokens', term: 'special token', group: 'translate', slug: 'special-tokens',
      en: { tip: 'A special token is a reserved marker, not text: <|im_start|> and <|im_end|> open and close a turn of the chat, <|endoftext|> ends a text. The model ends a story by writing <|im_end|> itself.' },
      ru: { word: 'служебный токен', tip: 'Зарезервированная метка, а не текст. <|im_start|> и <|im_end|> открывают и закрывают реплику в чате, <|endoftext|> завершает текст. Историю модель заканчивает сама, когда пишет <|im_end|>.' } },
    { id: 'instruct', term: 'Instruct', group: 'keep', slug: 'instruct', source: 'instruct models on Hugging Face',
      en: { tip: 'Instruct: the model follows a request written in the chat format, here a story with your words.' },
      ru: { word: 'по инструкции', tip: 'Модель выполняет просьбу, записанную в формате чата. Здесь это история с вашими словами.' } },
    { id: 'completion', term: 'Completion', group: 'keep', slug: 'completion', source: 'completions API, base models',
      en: { tip: 'Completion: the model simply continues the text you started, without any request.' },
      ru: { word: 'продолжение текста', tip: 'Модель просто продолжает начатый вами текст, без всякой просьбы.' } },
    // --- устройство модели
    { id: 'model', term: 'transformer', group: 'calque', slug: 'transformer',
      en: { tip: 'A transformer: each token becomes a list of numbers, passes through three layers of attention and MLP, and comes out as a score for every next token.' },
      ru: { word: 'трансформер', tip: 'Каждый токен превращается в список чисел, проходит три слоя attention и MLP и на выходе даёт оценку каждому следующему токену.' } },
    { id: 'embedding', term: 'embedding', group: 'calque', slug: 'residual-stream',
      en: { tip: 'The embedding turns a token into a list of 112 numbers, the starting point of its trip through the layers.' },
      ru: { word: 'эмбеддинг', tip: 'Превращает токен в список из 112 чисел. С него начинается путь токена через слои.' } },
    { id: 'residualStream', term: 'residual stream', group: 'translate', slug: 'residual-stream',
      en: { tip: 'The residual stream is the running list of numbers for a token. Every layer reads it and adds its own contribution on top.' },
      ru: { word: 'остаточный поток', tip: 'Текущий список чисел токена. Каждый слой читает его и добавляет сверху свой вклад.' } },
    { id: 'attention', term: 'attention', group: 'keep', short: 'attn', slug: 'attention',
      en: { tip: 'Attention lets each token look back at earlier tokens and take what it needs from them to predict the next one.' },
      ru: { word: 'внимание', tip: 'Позволяет каждому токену оглянуться на прежние и взять из них то, что нужно для предсказания следующего.', avoid: ['вним\\.', '(^|[^а-яё])внимани[ея]( слоя|:| займ|$)', 'головы? внимания', 'веса внимания'] } },
    { id: 'head', term: 'attention head', group: 'translate', slug: 'attention-head',
      en: { tip: 'An attention head is one independent way of looking back. Each layer has four heads, and each learns to notice different things.' },
      ru: { word: 'голова', label: 'голова attention', tip: 'Один независимый способ оглядываться назад. В каждом слое четыре головы, и каждая учится замечать своё.' } },
    { id: 'weights', term: 'attention weights', group: 'translate', slug: 'attention-head',
      en: { tip: 'Attention weights: what share of its attention a head gives to each earlier token.' },
      ru: { word: 'веса', label: 'веса attention', tip: 'Какую долю внимания голова отдаёт каждому прошлому токену.' } },
    { id: 'valueWeighted', term: 'value-weighted', group: 'translate', slug: 'attention-head', source: 'norm-based attribution, Kobayashi et al., 2020',
      en: { tip: 'Weight × how much information the head actually takes from that token. Looking is not the same as taking.' },
      ru: { word: 'с учётом value', tip: 'Вес × сколько информации голова реально забирает из токена. Смотреть и брать не одно и то же.' } },
    { id: 'kvCache', term: 'KV cache', group: 'keep', slug: 'grouped-query-attention',
      en: { tip: 'The KV cache keeps the key and the value of every earlier token, so they are computed once and not at every step.' },
      ru: { word: 'кэш ключей и значений', label: 'KV-кэш', tip: 'Хранит ключ и значение каждого прошлого токена, чтобы считать их один раз, а не на каждом шаге.' } },
    { id: 'gqa', term: 'GQA', group: 'keep', slug: 'grouped-query-attention', source: 'grouped-query attention, Ainslie et al., 2023',
      en: { tip: 'Grouped-query attention: several heads ask their own questions but share one set of keys and values, so the KV cache is smaller.' },
      ru: { word: 'attention с общими ключами', tip: 'Несколько голов задают свои запросы, но читают один набор ключей и значений, поэтому KV-кэш меньше.' } },
    { id: 'qkNorm', term: 'QK-norm', group: 'keep', slug: 'qk-norm',
      en: { tip: 'QK-norm brings queries and keys to one scale before they are compared, so attention scores stay in a steady range.' },
      ru: { word: 'нормировка запросов и ключей', tip: 'Приводит запросы и ключи к одному масштабу перед сравнением, чтобы оценки attention держались в ровном диапазоне.' } },
    { id: 'rope', term: 'RoPE', group: 'keep', slug: 'rope', source: 'rotary position embedding, Su et al., 2021',
      en: { tip: 'RoPE tells attention about word order: queries and keys are rotated by an angle that depends on the position.' },
      ru: { word: 'поворотное кодирование позиции', tip: 'Сообщает attention порядок слов: запросы и ключи поворачиваются на угол, зависящий от позиции.' } },
    { id: 'rmsnorm', term: 'RMSNorm', group: 'keep', slug: 'rmsnorm',
      en: { tip: 'RMSNorm brings the stream to one scale before a block reads it, so the block sees the same kind of input at any depth.' },
      ru: { word: 'нормировка по среднеквадратичному', tip: 'Приводит поток к одному масштабу, прежде чем его прочитает блок, чтобы блок видел его одинаково на любой глубине.' } },
    { id: 'mlp', term: 'MLP', group: 'keep', slug: 'mlp', source: 'multilayer perceptron',
      en: { tip: 'The MLP is the second half of each layer: 336 neurons per layer that react to patterns and push certain next words up or down.' },
      ru: { word: 'многослойный перцептрон', tip: 'Вторая половина каждого слоя. 336 нейронов на слой реагируют на шаблоны и подталкивают одни следующие слова вверх, другие вниз.' } },
    { id: 'swiglu', term: 'SwiGLU', group: 'keep', slug: 'swiglu',
      en: { tip: 'SwiGLU is how the MLP is built: the input is expanded twice, as a signal and as a gate, and the gate decides how much of each signal passes.' },
      ru: { word: 'MLP с затвором', tip: 'Устройство MLP: вход разворачивается дважды, как сигнал и как затвор, и затвор решает, сколько каждого сигнала пройдёт.' } },
    { id: 'logitLens', term: 'logit lens', group: 'keep', slug: 'logit-lens',
      en: { tip: 'Logit lens: decode the stream in the middle of the model as if it were the end, to see what it would say at this point.' },
      ru: { word: 'линза логитов', tip: 'Прочитать поток в середине модели так, будто это её конец, и увидеть, что она сказала бы на этом месте.' } },
    // --- выбор токена
    { id: 'logits', term: 'logits', group: 'calque', slug: 'logits',
      en: { tip: "Logits are the model's raw scores for all 4,096 tokens. Softmax turns them into probabilities that add up to 100%." },
      ru: { word: 'логиты', tip: 'Сырые оценки модели для всех 4096 токенов. Softmax превращает их в вероятности, которые в сумме дают 100%.' } },
    { id: 'sampling', term: 'sampling', group: 'calque', slug: 'sampling',
      en: { tip: 'Sampling is how one token is chosen from the probabilities: a weighted random draw, shaped by temperature and top-k.' },
      ru: { word: 'сэмплинг', tip: 'Как из вероятностей выбирается один токен. Это взвешенный жребий, которому форму задают температура и top-k.' } },
    { id: 'temperature', term: 'temperature', group: 'calque', slug: 'temperature',
      en: { tip: 'How bold the choice is. Low temperature almost always takes the most likely token; high gives more surprising words and more mistakes.' },
      ru: { word: 'температура', tip: 'Насколько смелый выбор. Низкая почти всегда берёт самый вероятный токен, высокая даёт неожиданные слова и больше ошибок.' } },
    { id: 'topK', term: 'top-k', group: 'keep', slug: 'top-k',
      en: { tip: 'Top-k: the model draws only from the K most likely tokens; everything else is ruled out.' },
      ru: { word: 'K лучших', tip: 'Модель выбирает только среди K самых вероятных токенов, остальные исключены.' } },
    { id: 'minP', term: 'min-p', group: 'keep', slug: 'min-p',
      en: { tip: 'Min-p: the model never draws a token that is more than 1/min-p times less likely than the favourite. At 0.02 that rules out tokens 50 times less likely: rare slips that break words.' },
      ru: { word: 'порог от фаворита', tip: 'Модель не выбирает токен, который в 1/min-p раз и более менее вероятен, чем фаворит. При 0,02 отсекаются токены, в 50 раз менее вероятные: редкие срывы, которые ломают слова.' } },
    { id: 'seed', term: 'seed', group: 'keep', slug: 'seed',
      en: { tip: 'Seed: the number that fixes the random draws. Same seed and same settings give exactly the same story.' },
      ru: { word: 'зерно случайности', tip: 'Число, которое задаёт случайные броски. Тот же seed и те же настройки дают ровно ту же историю.' } },
    { id: 'entropy', term: 'entropy', group: 'calque', slug: 'entropy',
      en: { tip: 'How spread out the choice is, in bits: 0 means completely sure, higher means more options compete.' },
      ru: { word: 'энтропия', tip: 'Насколько размазан выбор, в битах: 0 значит полностью уверена, больше значит спорят больше вариантов.' } },
    { id: 'maxNew', term: 'max new tokens', group: 'translate', slug: 'max-new-tokens', source: 'max_new_tokens in Hugging Face',
      en: { tip: 'The longest answer the model may write, in tokens.' },
      ru: { word: 'макс. новых токенов', tip: 'Самый длинный ответ, который модель может написать, в токенах.' } },
    // --- ограничения
    { id: 'loopPenalty', term: 'repetition penalty', group: 'translate', slug: 'repetition-penalty', source: 'repetition_penalty in Hugging Face',
      en: { tip: 'Repetition penalty: lowers the score of a token that would repeat a four-token phrase already written in this story, unless the phrase is common in children’s stories (“Once upon a time”). Uses statistics of the training corpus.' },
      ru: { word: 'штраф за повторы', tip: 'Понижает оценку токена, который повторил бы фразу из четырёх токенов, уже написанную в этой истории, если только эта фраза не частая в детских историях («Once upon a time»). Опирается на статистику обучающего корпуса.' } },
    { id: 'logitBias', term: 'logit bias', group: 'keep', slug: 'logit-bias', source: 'logit_bias in the OpenAI API, llama.cpp',
      en: { tip: "Logit bias: a bonus added to a token's score before the choice, here for keywords not used yet." },
      ru: { word: 'доплата к оценке', tip: 'Доплата к оценке токена перед выбором, здесь для ещё не использованных ключевых слов.' } },
    { id: 'fsm', term: 'constrained decoding (FSM)', group: 'keep', slug: 'fsm', source: 'constrained decoding on a finite-state machine, as in Outlines',
      en: { tip: 'Constrained decoding: once a keyword is started, a small finite-state machine (FSM) makes the model finish spelling it.' },
      ru: { word: 'декодирование с ограничениями', tip: 'Когда ключевое слово начато, маленький конечный автомат (FSM) заставляет модель дописать его по буквам.' } },
  ];
  // подсказка: на английском объяснение уже начинается с термина; на остальных языках — «English term · слово. Объяснение.»
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const tipOf = (t, lang) => { const L = t[lang]; if (!L) return null;
    return lang === 'en' ? L.tip : `${cap(t.term)} · ${L.word}. ${L.tip}`; };
  const W = root.window || root;
  W.MQ_GLOSSARY = { langs: LANGS, terms: T, tipOf };
  const D = W.MQ_DICTS = W.MQ_DICTS || {};
  for (const lang of LANGS) { D[lang] = D[lang] || {}; for (const t of T) { const s = tipOf(t, lang); if (s) D[lang]['gl.' + t.id] = s; } }
})(typeof window !== 'undefined' ? window : globalThis);
