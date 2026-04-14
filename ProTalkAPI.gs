// =============================================================================
//  PROTALK API & AI ROUTER
// =============================================================================

// ─── КОНСТАНТЫ ───────────────────────────────────────────────────────────────
const FUNCTIONS_BASE_ID     = "appkq3HrzrxYxoAV8"; // константа
const PROTALK_HOST          = "api.pro-talk.ru";
const ROUTER_URL            = "https://ai.pro-talk.ru/api/router";
const FILE_UPLOAD_URL       = "https://file.pro-talk.ru/tgf";   // хранилище скриншотов
const TASK_POLL_INTERVAL_MS = 8000;   // 8 сек между опросами
const TASK_TIMEOUT_S        = 300;    // 5 мин максимум ожидания

// ID ProTalk-функций
const FN_SEARCH     = 489;   // Поиск в Google
const FN_SCREENSHOT = 311;   // Скрин + HTML сайта
const FN_VISION     = 640;   // Анализ изображения (vision)
const FN_TELEGRAM   = 57;    // Уведомление в Telegram

// =============================================================================
//  ЗАГРУЗКА СКРИНШОТА В file.pro-talk.ru
// =============================================================================

/**
 * Загружает изображение по URL в хранилище ProTalk.
 * @param {string} imageUrl  — временная ссылка на скриншот (tmpfiles.org и т.п.)
 * @param {string} token     — X-Upload-Token из CONFIG → FILE_UPLOAD_TOKEN
 * @returns {string|null}    — постоянная ссылка или null при ошибке
 */
function uploadScreenshot(imageUrl, token) {
  if (!imageUrl || !token) return null;
  try {
    const resp = UrlFetchApp.fetch(FILE_UPLOAD_URL, {
      method:  "post",
      payload: { url: imageUrl },          // form-data: поле "url"
      headers: { "X-Upload-Token": token },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log("uploadScreenshot HTTP " + resp.getResponseCode() + ": " + resp.getContentText());
      return null;
    }
    const data = JSON.parse(resp.getContentText());
    return data.url || null;
  } catch (e) {
    Logger.log("uploadScreenshot error: " + e.message);
    return null;
  }
}

// =============================================================================
//  PROTALK: вызов долгой функции (polling)
// =============================================================================

function callProTalkFunction(cfg, functionId, args) {
  const taskId = "f" + functionId + "_task_" + randomString(9);

  const triggerPayload = {
    bot_id:     Number(cfg.BOT_ID),
    bot_token:  cfg.BOT_TOKEN,
    task_type:  "api_call",
    repeat:     "Once",
    trigger_id: String(Date.now()),
    parameters: {
      api_url: "https://" + PROTALK_HOST + "/api/v1.0/run_function",
      method:  "POST",
      payload: {
        function_id:       functionId,
        functions_base_id: FUNCTIONS_BASE_ID,
        bot_id:            Number(cfg.BOT_ID),
        bot_token:         cfg.BOT_TOKEN,
        arguments:         Object.assign({ task_id: taskId }, args)
      }
    }
  };

  try {
    const r = UrlFetchApp.fetch(
      "https://eu1.account.dialog.ai.atiks.org/proxy/tasks",
      {
        method: "post", contentType: "application/json",
        payload: JSON.stringify(triggerPayload),
        muteHttpExceptions: true
      }
    );
    if (r.getResponseCode() >= 400)
      return { success: false, error: "task_create_failed: HTTP " + r.getResponseCode(), task_id: taskId };
  } catch (e) {
    return { success: false, error: "task_create_exception: " + e.message, task_id: taskId };
  }

  const deadline = Date.now() + TASK_TIMEOUT_S * 1000;
  while (Date.now() < deadline) {
    Utilities.sleep(TASK_POLL_INTERVAL_MS);
    try {
      const pr = UrlFetchApp.fetch(
        "https://" + PROTALK_HOST + "/api/v1.0/get_function_result",
        {
          method: "post", contentType: "application/json",
          payload: JSON.stringify({
            task_id:          taskId,
            bot_id:           Number(cfg.BOT_ID),
            bot_token:        cfg.BOT_TOKEN,
            dialogs_api_host: PROTALK_HOST
          }),
          muteHttpExceptions: true
        }
      );
      const r = JSON.parse(pr.getContentText());
      if (r.status === "done")  return { success: true,  result: r, task_id: taskId };
      if (r.status === "error") return { success: false, error: r.error || "unknown", task_id: taskId };
    } catch (_) { /* продолжаем polling */ }
  }
  return { success: false, error: "timeout", task_id: taskId };
}

// =============================================================================
//  AI ROUTER: текстовый запрос, структурированный вывод, вызов функций
// =============================================================================

/**
 * Вызов AI Router (OpenRouter) через ProTalk
 * @param {Object} cfg - Конфигурация (USER_EMAIL, AUTH_TOKEN)
 * @param {string|Array} promptOrMessages - Текстовый промпт (строка) или массив сообщений [{role: "user", content: "..."}]
 * @param {string} [model] - Название модели (по умолчанию "openai/gpt-5.4-mini")
 * @param {Object} [options] - Дополнительные параметры (temperature, max_tokens, response_format, tools, tool_choice)
 * @returns {Object} - Результат {success: true, text: "...", message: {...}, tool_calls: [...]} или {success: false, error: "..."}
 */
function callAIRouter(cfg, promptOrMessages, model, options = {}) {
  let messages = [];
  if (typeof promptOrMessages === "string") {
    messages = [{ role: "user", content: promptOrMessages }];
  } else if (Array.isArray(promptOrMessages)) {
    messages = promptOrMessages;
  } else {
    return { success: false, error: "Invalid prompt format. Must be string or array of messages." };
  }

  const payload = {
    base_url:    "https://openrouter.ai/api/v1/chat/completions",
    platform:    "ProTalk",
    user_email:  cfg.USER_EMAIL,
    model:       model || "openai/gpt-5.4-mini",
    messages:    messages,
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
    max_tokens:  options.max_tokens || 1024,
    stream:      false
  };

  // Добавляем структурированный вывод, если передан
  if (options.response_format) {
    payload.response_format = options.response_format;
  }

  // Добавляем инструменты (функции), если переданы
  if (options.tools) {
    payload.tools = options.tools;
    if (options.tool_choice) {
      payload.tool_choice = options.tool_choice;
    }
  }

  try {
    const resp = UrlFetchApp.fetch(ROUTER_URL, {
      method: "post", contentType: "application/json",
      headers: { "Authorization": "Bearer " + cfg.AUTH_TOKEN },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const data = JSON.parse(resp.getContentText());
    
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const message = data.choices[0].message;
      const result = { 
        success: true, 
        text: message.content || "",
        message: message
      };
      
      if (message.tool_calls) {
        result.tool_calls = message.tool_calls;
      }
      
      return result;
    }
    
    return { success: false, error: JSON.stringify(data).substring(0, 300) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
