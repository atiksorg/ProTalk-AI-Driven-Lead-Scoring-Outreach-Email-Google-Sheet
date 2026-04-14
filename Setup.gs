// =============================================================================
// SETUP.gs — Создание структуры Комбайна v4.0
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🤖 Комбайн v4.0")
    .addItem("▶️ Запустить сейчас",         "runCombine")
    .addSeparator()
    .addItem("⚙️ Создать/Обновить листы",   "setupSheets")
    .addItem("⏱️ Создать триггер (30 мин)", "createTrigger")
    .addSeparator()
    .addItem("🔌 Тест ProTalk API",         "testConnection")
    .addItem("📨 Тест Telegram",            "testTelegram")
    .addToUi();
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. CONFIG
  createSheet(ss, SHEET_CONFIG, ["Параметр", "Значение", "Описание"], [
    ["BOT_ID", "", "ID бота ProTalk"],
    ["BOT_TOKEN", "", "Токен бота ProTalk"],
    ["AUTH_TOKEN", "", "Bearer-токен для AI Router"],
    ["USER_EMAIL", "", "Email пользователя"],
    ["FILE_UPLOAD_TOKEN", "", "X-Upload-Token для хранилища"],
    ["DEFAULT_MODEL", "openai/gpt-5.4-mini", "Модель ИИ"],
    ["SENDER_NAME", "Мой Бизнес", "Имя отправителя"],
    ["CC_EMAIL", "", "Копия письма"],
    ["REPLY_TO", "", "Reply-To адрес"],
    ["TG_BOT_TOKEN", "", "Токен Telegram-бота (от @BotFather)"],
    ["TG_CHAT_ID", "", "ID чата/канала для уведомлений о HOT LEADS"]
  ]);

  // 2. CAMPAIGNS
  createSheet(ss, SHEET_CAMPAIGNS, 
    ["ID Кампании", "Статус", "Режим (full/html_only/skip)", "ID Секвенции", "Проходной балл", "Балл для HOT_LEADS", "Промпт Vision (Анализ скрина)", "Промпт A (Icebreaker)", "Промпт B (A/B тест)", "Авто-отправка HOT_LEADS (yes/no)"], [
    ["CAMP_01", "active", "full", "SEQ_WEB", "50", "80", 
     "Оцени дизайн сайта. Выглядит ли он устаревшим (до 2018 года)?",
     "Ты эксперт. Напиши ледокол, упомянув CMS сайта и адаптивность.", 
     "Ты маркетолог. Напиши ледокол с фокусом на конверсию и отсутствие аналитики.",
     "no"]
  ]);

  // 2.1 QUERIES
  createSheet(ss, SHEET_QUERIES,
    ["ID Кампании", "Поисковый запрос", "Страна", "Кол-во результатов", "Статус"], [
    ["CAMP_01", "купить подстанцию ктп в таганроге от производителя", "ru", "10", "active"],
    ["CAMP_01", "бетонные наливные полы Владивосток смета", "ru", "10", "active"],
    ["CAMP_01", "установка сигнализаций в офисе Санкт-Петербург", "ru", "10", "active"]
  ]);

  // 3. SEQUENCES — только структура (шаг, задержка).
  // Тексты писем хранятся в EMAIL_TEMPLATES (offer_text, followup_text, signature).
  // Тема шага 1 берётся из EMAIL_TEMPLATES.subject (приоритет) или из этой колонки (запасной вариант).
  createSheet(ss, SHEET_SEQUENCES, 
    ["ID Секвенции", "Шаг", "Задержка (дней)", "Тема (запасная, если нет в EMAIL_TEMPLATES)", "Заметка"], [
    ["SEQ_WEB", "1", "0", "Идеи по сайту {domain}", "Шаг 1: icebreaker + оффер из EMAIL_TEMPLATES"],
    ["SEQ_WEB", "2", "3", "", "Шаг 2: followup_text из EMAIL_TEMPLATES"],
    ["SEQ_WEB", "3", "7", "", "Шаг 3: followup_text из EMAIL_TEMPLATES (последнее письмо)"]
  ]);

  // 4. AB_RESULTS
  createSheet(ss, SHEET_AB_RESULTS, 
    ["ID Кампании", "Промпт", "Отправлено", "Ответов", "Конверсия %"], [
    ["CAMP_01", "A", "0", "0", "0%"],
    ["CAMP_01", "B", "0", "0", "0%"]
  ]);

  // 5. DOMAIN_ARCHIVE
  createSheet(ss, SHEET_DOMAIN_ARCHIVE, ["Домен", "Дата последнего контакта", "Кампания"], []);

  // 6. HOT_LEADS
  createSheet(ss, SHEET_HOT_LEADS, ["Дата", "Скор", "Домен", "Email", "Кампания", "Контекст (HTML+Vision)", "Скриншот", "Решение (send/skip)", "Статус обработки"], []);

  // 7. TASKS
  createSheet(ss, SHEET_TASKS, 
    ["URL сайта", "Кампания", "Промпт (A/B)", "Статус", "Шаг Секвенции", "Дата обновления", "Email", "Thread ID", "Скор", "Контекст"], []);

  // 8. EMAIL_TEMPLATES
  // Колонка "Режим ИИ" управляет тем, как ИИ работает с текстом оффера:
  //   strict  — ИИ пишет только персональный ледокол (2-3 предложения),
  //             оффер вставляется в письмо ДОСЛОВНО без изменений.
  //             Используй когда в оффере есть точные цифры, ссылки, юридические формулировки.
  //   rewrite — ИИ адаптирует оффер под конкретный сайт (меняет слова, акценты),
  //             но обязан сохранить все ссылки и числа без изменений.
  //             Используй для более живых, персонализированных писем.
  //   full    — ИИ пишет всё письмо целиком сам, оффер — только бриф/инструкция.
  //             Максимальная свобода ИИ. Подпись и тема всегда строгие во всех режимах.
  createSheet(ss, SHEET_EMAIL_TEMPLATES, 
    ["ID Кампании", "Тема письма", "Модель ИИ", "Текст оффера", "Текст фоллоу-апа", "Подпись", "Режим ИИ (strict/rewrite/full)"], [
    ["CAMP_01", "Хотите увидеть Ваш будующий сайт?", "openai/gpt-5.4-mini", 
     "Мы — АТИКС, делаем современные одностраничные сайты (лендинги) под ключ за 24 часа.\nПредлагаем бесплатно подготовить для вас предварительный макет вашего будущего сайта уже в течение 24 часов.\nНужно только прислать логотип и краткое описание компании.\nПосмотреть, как это работает, и оставить заявку можно здесь:\nПолучить бесплатный макет сайта за 24 часа: https://l.atiks.org/#lead-form\nЕсли макет понравится — быстро доведём его до полноценного рабочего лендинга на вашем домене.", 
     "Хотел напомнить о моём предыдущем письме.\nЕсли вам актуально обновить сайт или сделать новый лендинг — предлагаю бесплатно подготовить для вас предварительный макет уже в течение 24 часов.\nЗаполнить заявку можно по ссылке ниже (нужен только логотип и описание компании):\nПолучить бесплатный макет за 24 часа: https://l.atiks.org/#lead-form", 
     "С уважением,\nАндрей Тиунов,\nРуководитель проектов АТИКС",
     "strict"]
  ]);

  // Остальные листы
  createSheet(ss, SHEET_BLACKLIST, ["Домен или Email", "Причина"], [["competitor.ru", "Конкурент"]]);
  createSheet(ss, SHEET_SCHEDULE, ["Параметр", "Значение", "Описание"], [
    ["WORK_HOURS_START", "0", "Час начала работы (0-23)"],
    ["WORK_HOURS_END", "24", "Час окончания работы (0-23)"],
    ["WORK_DAYS", "Mon,Tue,Wed,Thu,Fri", "Рабочие дни"],
    ["MAX_EMAILS_PER_DAY", "50", "Максимум писем в сутки"]
  ]);
  createSheet(ss, SHEET_LOG, ["Дата", "Статус", "Скор", "Кампания", "URL", "Email", "Скриншот", "Детали"], []);

  SpreadsheetApp.getUi().alert("✅ Структура v4.0 создана! Заполни лист CAMPAIGNS.");
}

function createSheet(ss, name, headers, defaultData) {
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, 1, headers.length).setValues([headers]);
    s.getRange(1, 1, 1, headers.length).setBackground("#1a1a2e").setFontColor("#fff").setFontWeight("bold");
    if (defaultData && defaultData.length > 0) {
      s.getRange(2, 1, defaultData.length, defaultData[0].length).setValues(defaultData);
    }
  }
}

function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("runCombine").timeBased().everyMinutes(30).create();
  SpreadsheetApp.getUi().alert("✅ Триггер создан (30 минут).");
}