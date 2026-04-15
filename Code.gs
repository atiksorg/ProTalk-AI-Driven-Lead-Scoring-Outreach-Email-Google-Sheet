// =============================================================================
// Code.gs — КОМБАЙН v4.0: Скорринг, Секвенции, HTML-Интеллект
// =============================================================================

function checkQuota() {
  const quota = MailApp.getRemainingDailyQuota();
  Logger.log(quota);
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = readConfig(ss);
  
  sendTelegramNotification(cfg, `ℹ️ <b>Остаток квоты Gmail:</b> ${quota} писем.`);
}

function runCombine() {
  console.log("Запуск Комбайна v4.0...");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = readConfig(ss);

  const schedule = getScheduleConfig(ss);
  if (getDailySentCount(ss) >= schedule.maxEmails) {
    console.log(`Дневной лимит писем (${schedule.maxEmails}) достигнут. Ждем завтра.`);
    return;
  }  // 1. Обработка ручных решений HOT_LEADS (приоритет — до фоллоу-апов)
  try {
    if (processHotLeadDecisions(ss, cfg)) return;
  } catch(e) {
    console.log(`⚠️ Ошибка в processHotLeadDecisions (Gmail лимит?): ${e.message}. Продолжаем к новым задачам.`);
  }  // 2. Обработка Секвенций (Фоллоу-апы)
  if (String(cfg.ENABLE_FOLLOWUPS).trim() === "1") {
    try {
      if (processFollowUps(ss, cfg)) return; // Если обработали фоллоу-ап, выходим
    } catch(e) {
      console.log(`⚠️ Ошибка в processFollowUps (Gmail лимит?): ${e.message}. Продолжаем к новым задачам.`);
    }
  }

  // 3. Поиск новых задач
  const tasksSheet = ss.getSheetByName(SHEET_TASKS);
  let pendingTasks = getTasksByStatus(tasksSheet, "new");

  if (pendingTasks.length === 0) {
    const campaigns = getActiveCampaigns(ss);
    if (campaigns.length === 0) { console.log("Нет активных кампаний"); return; }    // Берем случайную кампанию и случайный запрос из неё
    const camp = campaigns[Math.floor(Math.random() * campaigns.length)];
    const queries = getQueriesForCampaign(ss, camp.id);
    if (queries.length === 0) { console.log(`Нет активных запросов для кампании ${camp.id}`); return; }
    const queryObj = queries[Math.floor(Math.random() * queries.length)];
    
    console.log(`Поиск: ${queryObj.query} (Кампания: ${camp.id})`);
    const searchRes = callProTalkFunction(cfg, FN_SEARCH, { query: queryObj.query, country: queryObj.country, num_results: queryObj.num_results, start_position: queryObj.start_position });
    
    if (searchRes.success && searchRes.result.result) {
      let urls = searchRes.result.result;
      if (Array.isArray(urls)) {
        urls.forEach(url => {
          tasksSheet.appendRow([url, camp.id, "", "new", "1", new Date(), "", "", "", ""]);
        });
        pendingTasks = getTasksByStatus(tasksSheet, "new");
      } else {
        console.log("Ошибка поиска: результат не является массивом", urls);
        return;
      }
    } else {
      console.log("Ошибка поиска");
      return;
    }
  }

  // 3. Обработка одной новой задачи
  if (pendingTasks.length > 0) {
    const task = pendingTasks[Math.floor(Math.random() * pendingTasks.length)];
    processInitialTask(ss, cfg, task);
  }
}

function processInitialTask(ss, cfg, task) {
  const tasksSheet = ss.getSheetByName(SHEET_TASKS);
  const campaigns = getActiveCampaigns(ss);
  const camp = campaigns.find(c => c.id === task.campaign);  if (!camp) {
    updateTaskStatus(tasksSheet, task.rowNum, "error_no_campaign");
    logRow(ss, {status: "ERROR_NO_CAMPAIGN", url: task.url, campaign: task.campaign, details: `Кампания ${task.campaign} не найдена`});
    return;
  }

  console.log(`Обработка: ${task.url} (Режим: ${camp.mode})`);  // 1. Получение HTML (через ProTalk если нужен скриншот, иначе напрямую)
  let html = "", screenshotUrl = "";
  if (camp.mode === "full") {
    const siteRes = callProTalkFunction(cfg, FN_SCREENSHOT, { url_to_open: task.url, html_include: true });
    if (siteRes.success) {
      html = siteRes.result.result.html || "";
      const rawScreenshotUrl = siteRes.result.result.screenshot_url || "";

      // Переводим временную ссылку (tmpfiles.org и т.п.) в постоянную через хранилище ProTalk
      if (rawScreenshotUrl && cfg.FILE_UPLOAD_TOKEN) {
        const permanentUrl = uploadScreenshot(rawScreenshotUrl, cfg.FILE_UPLOAD_TOKEN);
        if (permanentUrl) {
          screenshotUrl = permanentUrl;
          console.log(`📸 Скриншот загружен в постоянное хранилище: ${screenshotUrl}`);
        } else {
          // Загрузка не удалась — используем временную ссылку как запасной вариант
          screenshotUrl = rawScreenshotUrl;
          console.log(`⚠️ Не удалось загрузить скриншот в хранилище, используем временную ссылку: ${screenshotUrl}`);
        }
      } else {
        // Токен не задан — используем как есть
        screenshotUrl = rawScreenshotUrl;
        if (rawScreenshotUrl) {
          console.log(`⚠️ FILE_UPLOAD_TOKEN не задан в CONFIG, скриншот сохранён как временная ссылка: ${screenshotUrl}`);
        }
      }
    }
  } else {
    // Режим html_only или skip (экономим ProTalk)
    try {
      html = UrlFetchApp.fetch(task.url, {muteHttpExceptions: true}).getContentText();
    } catch(e) { console.log("Ошибка скачивания HTML"); }
  }  // 2. Глубокая разведка
  const intel = extractSiteIntelligence(html, task.url);
  const email = getBestEmail(intel.contacts.emails);

  // Блэклист
  const blacklist = getBlacklist(ss);  if (isBlacklisted(intel, email, blacklist)) {
    console.log(`Пропуск: ${intel.domain} или ${email} в черном списке`);
    updateTaskStatus(tasksSheet, task.rowNum, "blacklisted");
    logRow(ss, {status: "BLACKLISTED", campaign: camp.id, url: task.url, email: email, screenshot: screenshotUrl, details: "Находится в BLACKLIST"});
    return;
  }

  // Дедупликация
  if (!checkDomainCooldown(ss, intel.domain)) {
    console.log("Пропуск: домен на кулдауне");
    updateTaskStatus(tasksSheet, task.rowNum, "skipped_domain");
    logRow(ss, {status: "SKIPPED_DOMAIN", campaign: camp.id, url: task.url, email: email, screenshot: screenshotUrl, details: `Домен ${intel.domain} на кулдауне (90 дней)`});
    return;
  }

  // 3. Vision API (Опционально)
  let visionData = null;
  let visionRawAnswer = "";
  if (camp.mode === "full" && screenshotUrl) {
    const visionPromptUser = camp.visionPrompt || "Оцени сайт.";
    const vRes = callProTalkFunction(cfg, FN_VISION, {
      ai_model: "xiaomi/mimo-v2-omni",
      system_prompt: 'Оцени сайт. Выведи строго JSON: {"pass": true/false, "short_desc": "краткое описание", "full_desc": "подробное описание дизайна сайта, навигации, цветов и т.д."}',
      user_text: visionPromptUser,
      image_url: screenshotUrl
    });
    
    try { 
      // Безопасное извлечение ответа из любой вложенности ProTalk
      visionRawAnswer = String(
        (vRes.result && vRes.result.result && vRes.result.result.result && vRes.result.result.result.answer) ||
        (vRes.result && vRes.result.result && vRes.result.result.answer) || 
        (vRes.result && vRes.result.answer) || 
        ""
      );
      const jsonMatch = visionRawAnswer.match(/\{[\s\S]*\}/);
      if (jsonMatch) visionData = JSON.parse(jsonMatch[0]); 
    } catch(e) {
      console.log("Ошибка парсинга ответа Vision API: " + e.message);
    }
  }

  // 4. Скорринг
  const scoreData = calculateLeadScore(intel, visionData, camp.mode);
  console.log(`Скор: ${scoreData.score} (${scoreData.logs})`);

  // Сохраняем контекст в задачу
  tasksSheet.getRange(task.rowNum, 10).setValue(JSON.stringify(intel));
  tasksSheet.getRange(task.rowNum, 7).setValue(email || "");
  tasksSheet.getRange(task.rowNum, 9).setValue(scoreData.score);  if (!email || scoreData.score < camp.threshold) {
    updateTaskStatus(tasksSheet, task.rowNum, "rejected_score");
    logRow(ss, {status: "REJECTED", score: scoreData.score, campaign: camp.id, url: task.url, email: email, screenshot: screenshotUrl, details: `Скор ${scoreData.score} < порога ${camp.threshold}${!email ? " (нет email)" : ""}`, vision: visionRawAnswer});
    return;
  }  if (scoreData.score >= camp.hotLeadScore) {
    if (camp.autoSendHotLeads) {
      // Авто-отправка включена — сразу запускаем секвенцию
      console.log(`HOT LEAD (скор ${scoreData.score}) — авто-отправка включена, отправляем сразу.`);
      task.score = scoreData.score;
      task.email = email;
      task.screenshot = screenshotUrl;
      task.vision = visionRawAnswer; // <-- пробрасываем ответ Vision в задачу
      task.visionData = visionData; // <-- пробрасываем распарсенный JSON Vision в задачу
      // Фиксируем в HOT_LEADS как уже отправленный
      ss.getSheetByName(SHEET_HOT_LEADS).appendRow([
        new Date(), scoreData.score, intel.domain, email, camp.id, JSON.stringify(intel), screenshotUrl, "sent"
      ]);
      // Уведомление в Telegram (авто-режим)
      sendTelegramNotification(cfg,
        `🔥 <b>HOT LEAD</b> — письмо отправлено автоматически!\n\n` +
        `🏢 <b>Домен:</b> ${intel.domain}\n` +
        `📧 <b>Email:</b> ${email}\n` +
        `🎯 <b>Кампания:</b> ${camp.id}\n` +
        `⭐ <b>Скор:</b> ${scoreData.score}\n` +
        (screenshotUrl ? `🖼 <b>Скриншот:</b> ${screenshotUrl}\n` : "") +
        `\n✅ Письмо уже в пути — ручное действие не требуется.`
      );
      checkQuota();
      sendSequenceStep(ss, cfg, task, camp, intel, 1);
    } else {
      // Авто-отправка выключена — ждём ручного решения
      console.log(`HOT LEAD (скор ${scoreData.score}) — ожидает ручного решения в HOT_LEADS.`);
      ss.getSheetByName(SHEET_HOT_LEADS).appendRow([
        new Date(), scoreData.score, intel.domain, email, camp.id, JSON.stringify(intel), screenshotUrl, "Ожидает"
      ]);
      updateTaskStatus(tasksSheet, task.rowNum, "wait_manual");
      logRow(ss, {status: "HOT_LEAD_WAIT", score: scoreData.score, campaign: camp.id, url: task.url, email: email, screenshot: screenshotUrl, details: `Скор ${scoreData.score} — ожидает ручного решения`, vision: visionRawAnswer});
      // Уведомление в Telegram (ручной режим) — просим принять решение
      sendTelegramNotification(cfg,
        `🔥 <b>HOT LEAD</b> — требует вашего решения!\n\n` +
        `🏢 <b>Домен:</b> ${intel.domain}\n` +
        `📧 <b>Email:</b> ${email}\n` +
        `🎯 <b>Кампания:</b> ${camp.id}\n` +
        `⭐ <b>Скор:</b> ${scoreData.score}\n` +
        (screenshotUrl ? `🖼 <b>Скриншот:</b> ${screenshotUrl}\n` : "") +
        `\n👉 Откройте лист <b>🔥 HOT_LEADS</b> и поставьте <b>send</b> или <b>skip</b> в колонке H.`
      );
    }
    return;
  }  // 5. Отправка Шага 1
  task.email = email;                 // <-- Email получателя (ОБЯЗАТЕЛЬНО для createDraft!)
  task.score = scoreData.score;       // <-- Добавляем скор в память для логов
  task.screenshot = screenshotUrl;    // <-- Добавляем скриншот в память для логов
  task.vision = visionRawAnswer;      // <-- Добавляем ответ Vision в память для логов
  task.visionData = visionData;       // <-- Добавляем распарсенный JSON Vision в память
  sendSequenceStep(ss, cfg, task, camp, intel, 1);
}

function sendSequenceStep(ss, cfg, task, camp, intel, stepNum) {
  const sequence = getSequence(ss, camp.seqId);
  const step = sequence.find(s => s.stepNum === stepNum);
  if (!step) {
    updateTaskStatus(ss.getSheetByName(SHEET_TASKS), task.rowNum, "completed");
    return; // Секвенция закончена
  }

  // --- Загружаем шаблон из EMAIL_TEMPLATES (единый источник текстов) ---
  const tpl = getTemplateForCampaign(ss, camp.id);
  if (!tpl) {
    console.log(`ОШИБКА: Шаблон для кампании ${camp.id} не найден в EMAIL_TEMPLATES!`);
    updateTaskStatus(ss.getSheetByName(SHEET_TASKS), task.rowNum, "error_no_template");
    logRow(ss, {status: "ERROR_NO_TEMPLATE", campaign: camp.id, url: task.url, email: task.email, details: `Шаблон для кампании ${camp.id} не найден в EMAIL_TEMPLATES`});
    return;
  }

  // Модель ИИ: из EMAIL_TEMPLATES, иначе из CONFIG
  const aiModel = (tpl.model && String(tpl.model).trim()) ? String(tpl.model).trim() : (cfg.DEFAULT_MODEL || "openai/gpt-4o-mini");

  // Подпись — единая для всех шагов
  const signature = (tpl.signature && String(tpl.signature).trim()) ? `\n\n${String(tpl.signature).trim()}` : "";  let emailBody = "";
  let emailSubject = "";
  let variant = {label: "A", prompt: camp.promptA};
  let aiPromptUsed = "";

  if (stepNum === 1) {
    // ШАГ 1: сборка письма согласно режиму ИИ из EMAIL_TEMPLATES
    variant = selectVariant(ss, camp);

    // Тема: из EMAIL_TEMPLATES (приоритет), иначе из SEQUENCES — строго во всех режимах
    const tplSubject = String(tpl.subject || "").trim();
    const seqSubject = String(step.subject || "").trim();
    emailSubject = (tplSubject ? tplSubject : seqSubject).replace("{domain}", intel.domain);

    let visionContext = "";
    if (task.visionData && (task.visionData.short_desc || task.visionData.full_desc)) {
      visionContext = `Визуальное описание сайта (Vision AI):\nКратко: ${task.visionData.short_desc || "Нет"}\nПодробно: ${task.visionData.full_desc || "Нет"}`;
    } else if (task.vision) {
      visionContext = `Визуальное описание сайта (Vision AI): ${task.vision}`;
    }

    if (tpl.ai_mode === "strict") {
      // ─── STRICT: ИИ пишет только ледокол, оффер вставляется дословно ───────
      // Используй когда в оффере есть точные цифры, ссылки, юридические формулировки.
      const aiPrompt = [
        `Контекст сайта: ${JSON.stringify(intel)}`,
        visionContext,
        ``,
        `Инструкция: ${variant.prompt}`,
        ``,
        `Напиши ТОЛЬКО персональный ледокол — 2-3 предложения, которые покажут что ты изучил сайт.`,
        `Не пиши оффер, не пиши подпись. Только ледокол.`
      ].join("\n");
      aiPromptUsed = aiPrompt;

      const aiRes = callAIRouter(cfg, aiPrompt, aiModel);
      const icebreaker = aiRes.success ? aiRes.text.trim() : "";
      // Оффер вставляется дословно — ИИ его не трогает
      emailBody = (icebreaker ? icebreaker + "\n\n" : "") + tpl.offer_text + signature;

    } else if (tpl.ai_mode === "rewrite") {
      // ─── REWRITE: ИИ адаптирует оффер под сайт, ссылки и цифры — строго ────
      // Используй для более живых, персонализированных писем.
      const aiPrompt = [
        `Контекст сайта: ${JSON.stringify(intel)}`,
        visionContext,
        ``,
        `Инструкция (стиль): ${variant.prompt}`,
        ``,
        `Ниже — наш оффер. Перепиши его, адаптировав под специфику этого конкретного сайта.`,
        `ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:`,
        `- Все ссылки (https://...) оставь без изменений, дословно`,
        `- Все числа и цифры оставь без изменений`,
        `- Начни с персонального ледокола (2-3 предложения про их сайт)`,
        `- Затем адаптированный оффер`,
        ``,
        `Оффер:`,
        tpl.offer_text
      ].join("\n");
      aiPromptUsed = aiPrompt;

      const aiRes = callAIRouter(cfg, aiPrompt, aiModel);
      if (aiRes.success) {
        emailBody = aiRes.text + signature;
      } else {
        console.log("AI rewrite не сгенерирован, используем оффер напрямую.");
        emailBody = tpl.offer_text + signature;
      }

    } else {
      // ─── FULL: ИИ пишет всё письмо целиком, оффер — только бриф ────────────
      // Максимальная свобода ИИ. Используй когда оффер — это инструкция, а не готовый текст.
      const aiPrompt = [
        `Контекст сайта: ${JSON.stringify(intel)}`,
        visionContext,
        ``,
        `Инструкция (стиль): ${variant.prompt}`,
        ``,
        `Напиши холодное продающее письмо целиком. Бриф (что предлагаем):`,
        tpl.offer_text,
        ``,
        `Требования: персональный ледокол + оффер своими словами. Не пиши подпись.`
      ].join("\n");
      aiPromptUsed = aiPrompt;

      const aiRes = callAIRouter(cfg, aiPrompt, aiModel);
      if (aiRes.success) {
        emailBody = aiRes.text + signature;
      } else {
        console.log("AI full не сгенерирован, используем оффер напрямую.");
        emailBody = tpl.offer_text + signature;
      }
    }

  } else {
    // ШАГ 2+: Фоллоу-ап из EMAIL_TEMPLATES
    // Если фоллоу-апов несколько (шаги 3, 4...) — берём followup_text как базу
    emailBody = (tpl.followup_text || step.template || "") + signature;
    emailSubject = ""; // reply в тред, тема не нужна
  }  // Финальная замена плейсхолдеров
  emailBody = emailBody.replace(/\{domain\}/g, intel.domain || "");

  // --- Режим отладки: перенаправление на TEST_EMAIL ---
  let targetEmail = task.email;
  if (cfg.TEST_EMAIL && String(cfg.TEST_EMAIL).trim() !== "") {
    targetEmail = String(cfg.TEST_EMAIL).trim();
    console.log(`[DEBUG] Включен режим отладки. Письмо для ${task.email} перенаправлено на ${targetEmail}`);
    emailSubject = `[TEST for ${task.email}] ` + emailSubject;
  }  // --- Логируем что собираемся сделать ---
  console.log(`[INFO] Попытка отправить письмо на адрес: ${targetEmail}`);
  console.log(`[INFO] Тема письма: ${emailSubject || "Reply"}`);

  const isFakeSend = String(cfg.FAKE_MAIL_SEND).trim() === "1";

  try {
    let threadId = task.threadId;
    if (isFakeSend) {
      console.log(`[FAKE SEND] Письмо для ${targetEmail} не отправлено (включен FAKE_MAIL_SEND).`);
      threadId = threadId || "fake_thread_" + new Date().getTime();
      if (stepNum === 1) {
        logDomainContact(ss, intel.domain, camp.id);
        updateABStats(ss, camp.id, variant.label, "sent");
      }
    } else {
      if (stepNum === 1) {
        if (String(cfg.ENABLE_FOLLOWUPS).trim() === "1") {
          // Режим с фоллоу-апами (тратит 2 квоты, но сохраняет threadId)
          const draft = GmailApp.createDraft(targetEmail, emailSubject, emailBody, {name: cfg.SENDER_NAME});
          const msg = draft.send();
          threadId = msg.getThread().getId();
        } else {
          // Режим без фоллоу-апов (тратит 1 квоту, threadId не нужен)
          MailApp.sendEmail({
            to: targetEmail,
            subject: emailSubject,
            body: emailBody,
            name: cfg.SENDER_NAME
          });
          threadId = ""; // Фоллоу-апы выключены, threadId не сохраняем
        }
        logDomainContact(ss, intel.domain, camp.id); // Записываем домен
        updateABStats(ss, camp.id, variant.label, "sent");
      } else {
        const thread = GmailApp.getThreadById(task.threadId);
        thread.reply(emailBody, {name: cfg.SENDER_NAME});
      }
    }

    // --- Если ошибки нет, пишем об успехе ---
    console.log(`[SUCCESS] Письмо успешно отправлено в ${new Date()}`);

    const tasksSheet = ss.getSheetByName(SHEET_TASKS);
    updateTaskStatus(tasksSheet, task.rowNum, `wait_seq_${stepNum + 1}`);
    tasksSheet.getRange(task.rowNum, 8).setValue(threadId);
    tasksSheet.getRange(task.rowNum, 5).setValue(stepNum + 1);
    if (stepNum === 1) {
      tasksSheet.getRange(task.rowNum, 3).setValue(variant.label);
      
      // Отправляем уведомление в Telegram с деталями отправленного письма
      sendTelegramNotification(cfg,
        `✅ <b>Письмо отправлено (Шаг 1)</b>\n\n` +
        `🏢 <b>Домен:</b> ${intel.domain}\n` +
        `📧 <b>Email:</b> ${task.email}\n` +
        `🎯 <b>Кампания:</b> ${camp.id}\n` +
        `🤖 <b>Модель:</b> ${aiModel}\n\n` +
        `📝 <b>Промпт ИИ:</b>\n<pre>${escapeHtmlForTelegram(aiPromptUsed)}</pre>\n\n` +
        `✉️ <b>Сгенерированное письмо:</b>\n<pre>${escapeHtmlForTelegram(emailBody)}</pre>`
      );
    }

    logRow(ss, {status: isFakeSend ? "FAKE_SUCCESS" : "SUCCESS", score: task.score, campaign: camp.id, url: task.url, email: task.email, screenshot: task.screenshot, details: `Шаг ${stepNum} отправлен (модель: ${aiModel})`, body: emailBody, vision: task.vision || ""});
    
    logSendRow(ss, {
      status: isFakeSend ? "FAKE_SENT" : "SENT",
      campaign: camp.id,
      email: targetEmail,
      subject: emailSubject,
      body: emailBody,
      aiModel: aiModel,
      aiPrompt: aiPromptUsed,
      aiMode: tpl.ai_mode,
      threadId: threadId
    });

  } catch(e) {
    // --- Если ошибка есть, пишем её текст ---
    console.error(`[ERROR] Не удалось отправить письмо: ${e.message}`);

    updateTaskStatus(ss.getSheetByName(SHEET_TASKS), task.rowNum, "error_send");
    logRow(ss, {
      status: "ERROR_SEND",
      score: task.score,
      campaign: camp.id,
      url: task.url,
      email: task.email,
      screenshot: task.screenshot,
      details: `Шаг ${stepNum}: ${e.message}`,
      body: emailBody,        // ← сохраняем сгенерированное письмо даже при ошибке отправки
      vision: task.vision || "" // ← ответ Vision API
    });

    logSendRow(ss, {
      status: "ERROR",
      campaign: camp.id,
      email: targetEmail,
      subject: emailSubject,
      body: emailBody,
      aiModel: aiModel,
      aiPrompt: aiPromptUsed,
      aiMode: tpl.ai_mode,
      threadId: task.threadId,
      error: e.message
    });
  }
}

// --- Обработка ручных решений HOT_LEADS ---
function processHotLeadDecisions(ss, cfg) {
  const hotSheet = ss.getSheetByName(SHEET_HOT_LEADS);
  const tasksSheet = ss.getSheetByName(SHEET_TASKS);
  const data = hotSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const decision = String(data[i][7]).trim().toLowerCase(); // Колонка H: Решение
    const processStatus = String(data[i][8] || "").trim().toLowerCase(); // Колонка I: Статус обработки

    // Ищем строки где пользователь поставил "send" и они ещё не обработаны
    if (decision === "send" && processStatus !== "sent") {
      const email    = String(data[i][3]).trim();
      const campId   = String(data[i][4]).trim();
      const intelRaw = String(data[i][5]).trim();
      const score    = Number(data[i][1]) || 0;
      const screenshot = String(data[i][6] || "").trim();

      const camp = getActiveCampaigns(ss).find(c => c.id === campId);
      if (!camp) {
        console.log(`HOT_LEADS строка ${i+1}: кампания ${campId} не найдена, пропуск.`);
        hotSheet.getRange(i + 1, 9).setValue("error_no_campaign");
        continue;
      }

      let intel = {};
      try { intel = JSON.parse(intelRaw); } catch(e) { intel = { domain: data[i][2] }; }

      // Ищем соответствующую задачу в TASKS по email + статусу wait_manual
      const tasksData = tasksSheet.getDataRange().getValues();
      let taskRow = -1;
      for (let t = 1; t < tasksData.length; t++) {
        if (tasksData[t][6] === email && tasksData[t][3] === "wait_manual") {
          taskRow = t + 1;
          break;
        }
      }

      // Если задача не найдена — создаём синтетическую (на случай если строка была добавлена вручную)
      if (taskRow === -1) {
        const domain = intel.domain || data[i][2] || "";
        tasksSheet.appendRow([domain, campId, "", "wait_manual", "1", new Date(), email, "", score, intelRaw]);
        const newData = tasksSheet.getDataRange().getValues();
        taskRow = newData.length; // последняя строка
      }

      const task = {
        rowNum: taskRow,
        url: tasksSheet.getRange(taskRow, 1).getValue(),
        email: email,
        threadId: tasksSheet.getRange(taskRow, 8).getValue(),
        score: score,
        screenshot: screenshot
      };

      console.log(`HOT LEAD ручное решение: отправляем ${email} (кампания ${campId}, скор ${score})`);
      sendSequenceStep(ss, cfg, task, camp, intel, 1);

      // Помечаем строку в HOT_LEADS как обработанную
      hotSheet.getRange(i + 1, 9).setValue("sent");

      return true; // Обработали одну — выходим, следующая на следующем тике
    }

    // Если пользователь поставил "skip" — просто помечаем как пропущено
    if (decision === "skip" && processStatus !== "skipped") {
      const email = String(data[i][3]).trim();
      // Находим задачу и закрываем её
      const tasksData = tasksSheet.getDataRange().getValues();
      for (let t = 1; t < tasksData.length; t++) {
        if (tasksData[t][6] === email && tasksData[t][3] === "wait_manual") {
          updateTaskStatus(tasksSheet, t + 1, "skipped_manual");
          break;
        }
      }
      hotSheet.getRange(i + 1, 9).setValue("skipped");
      console.log(`HOT LEAD пропущен вручную: ${email}`);
    }
  }
  return false;
}

// --- Обработка фоллоу-апов ---
function processFollowUps(ss, cfg) {
  const tasksSheet = ss.getSheetByName(SHEET_TASKS);
  const data = tasksSheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][3]);
    if (status.startsWith("wait_seq_")) {
      const nextStepNum = Number(data[i][4]);
      const lastUpdate = new Date(data[i][5]);
      const email = data[i][6];
      const campId = data[i][1];
      
      const camp = getActiveCampaigns(ss).find(c => c.id === campId);
      if (!camp) continue;

      const sequence = getSequence(ss, camp.seqId);
      const step = sequence.find(s => s.stepNum === nextStepNum);

      if (!step) {
        updateTaskStatus(tasksSheet, i+1, "completed");
        continue;
      }      // Проверка ответа клиента (с защитой от лимита Gmail API)
      if (!SKIP_REPLY_CHECK) {
        try {
          const threads = GmailApp.search(`from:${email}`);
          if (threads.length > 0) {
            updateTaskStatus(tasksSheet, i+1, "replied");
            updateABStats(ss, campId, data[i][2], "reply");
            continue;
          }
        } catch(gmailErr) {
          // Лимит Gmail API исчерпан — пропускаем проверку ответа, не блокируем задачу
          console.log(`⚠️ Gmail API лимит при проверке ответа от ${email}: ${gmailErr.message}. Пропускаем проверку, продолжаем.`);
        }
      }

      // Проверка задержки
      const diffDays = (now - lastUpdate) / (1000 * 60 * 60 * 24);
      if (diffDays >= step.delayDays) {
        const intel = JSON.parse(data[i][9] || "{}");
        const task = { rowNum: i+1, url: data[i][0], email: email, threadId: data[i][7], score: data[i][8] };
        console.log(`Отправка фоллоу-апа шаг ${nextStepNum} для ${email}`);
        sendSequenceStep(ss, cfg, task, camp, intel, nextStepNum);
        return true; // Обработали 1 штуку, выходим из цикла
      }
    }
  }
  return false; // Ничего не отправлено
}
