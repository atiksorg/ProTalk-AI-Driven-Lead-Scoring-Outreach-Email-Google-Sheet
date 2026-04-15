// =============================================================================
// Scoring.gs — Система оценки (Lead Scoring)
// =============================================================================

function calculateLeadScore(intel, visionData, campaignMode) {
  let score = 50; // Базовый балл
  let logs = [];

  // 1. Оценка контактов
  if (intel.contacts.emails.length > 0) {
    let bestEmail = getBestEmail(intel.contacts.emails);
    if (/info@|sales@/i.test(bestEmail)) {
      score += 15; logs.push("+15 Бизнес-email");
    } else {
      score += 5; logs.push("+5 Обычный email");
    }
  } else {
    score -= 50; logs.push("-50 Нет email");
  }

  if (intel.contacts.phone) {
    score += 10; logs.push("+10 Есть телефон");
  }

  // 2. Оценка технической части
  if (!intel.isMobileFriendly) {
    score += 20; logs.push("+20 Нет адаптива (нужен редизайн)");
  }
  if (intel.cms === "WordPress" || intel.cms === "Joomla" || intel.cms === "1C-Bitrix") {
    score += 10; logs.push("+10 Старая/популярная CMS");
  }

  if (intel.analytics.length === 0) {
    score += 10; logs.push("+10 Нет аналитики (можно продать SEO/Маркетинг)");
  }

  if (intel.copyrightYear !== "Не найден" && parseInt(intel.copyrightYear) < new Date().getFullYear() - 2) {
    score += 15; logs.push("+15 Старый копирайт (сайт заброшен)");
  }

  // 3. Оценка Vision API (если применимо)
  if (campaignMode === "full" && visionData) {
    if (visionData.pass === true) { // Критерий ИИ подтвердил наше условие (например, "сайт старый?")
      score += 30; logs.push("+30 ИИ подтвердил критерий (pass: true)");
    } else {
      score -= 20; logs.push("-20 ИИ отклонил сайт (pass: false)");
    }
  }

  return { score, logs: logs.join(", ") };
}
