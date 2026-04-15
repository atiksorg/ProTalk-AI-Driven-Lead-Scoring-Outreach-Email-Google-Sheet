// =============================================================================
// HTMLParser.gs — Глубокая разведка по HTML (Извлечение контекста)
// =============================================================================

function extractSiteIntelligence(html, url) {
  const intelligence = {
    domain: url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split('/')[0].toLowerCase(),
    cms: "Неизвестно",
    isMobileFriendly: false,
    analytics: [],
    socials: [],
    hasEcomSignals: false,
    copyrightYear: "Не найден",
    contacts: {
      emails: [],
      phone: ""
    },
    rawTitle: extractTitle(html),
    rawDescription: extractMetaDescription(html)
  };

  if (!html) return intelligence;

  // 1. Поиск CMS
  if (/wp-content|wordpress/i.test(html)) intelligence.cms = "WordPress";
  else if (/bitrix/i.test(html)) intelligence.cms = "1C-Bitrix";
  else if (/tilda/i.test(html)) intelligence.cms = "Tilda";
  else if (/joomla/i.test(html)) intelligence.cms = "Joomla";
  else if (/shopify/i.test(html)) intelligence.cms = "Shopify";
  else if (/insales/i.test(html)) intelligence.cms = "InSales";

  // 2. Адаптивность (viewport)
  intelligence.isMobileFriendly = /<meta[^>]+name=["']viewport["']/i.test(html);

  // 3. Аналитика и пиксели
  if (/mc\.yandex\.ru/i.test(html)) intelligence.analytics.push("Yandex.Metrika");
  if (/google-analytics\.com|gtag/i.test(html)) intelligence.analytics.push("Google Analytics");
  if (/connect\.facebook\.net/i.test(html)) intelligence.analytics.push("FB Pixel");
  if (/vk\.com\/js\/api\/openapi\.js/i.test(html)) intelligence.analytics.push("VK Pixel");

  // 4. Соцсети
  if (/vk\.com\//i.test(html)) intelligence.socials.push("VK");
  if (/t\.me\//i.test(html)) intelligence.socials.push("Telegram");
  if (/instagram\.com\//i.test(html)) intelligence.socials.push("Instagram");
  if (/wa\.me|api\.whatsapp/i.test(html)) intelligence.socials.push("WhatsApp");

  // 5. Коммерция (магазин)
  intelligence.hasEcomSignals = /корзина|cart|add-to-cart|checkout|оформить заказ|купить/i.test(html);

  // 6. Год копирайта (старый сайт или обновляется)
  const copyrightMatch = html.match(/(?:©|copyright|&copy;)[^0-9]*20([0-2][0-9])/i);
  if (copyrightMatch) intelligence.copyrightYear = "20" + copyrightMatch[1];

  // 7. Контакты
  intelligence.contacts.emails = extractAllEmails(html);
  intelligence.contacts.phone = extractPhone(html);

  return intelligence;
}

function extractAllEmails(html) {
  let cleanHtml = html.replace(/<[^>]+>/g, " ");
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  let matches = cleanHtml.match(re) || [];
  // Фильтруем мусор
  matches = matches.filter(e => !/sentry|w3|schema|example|test/i.test(e));
  return [...new Set(matches)]; // Уникальные
}

function getBestEmail(emails) {
  if (!emails || emails.length === 0) return null;
  const priority = ["info@", "sales@", "hello@", "contact@"];
  for (let p of priority) {
    let found = emails.find(e => e.toLowerCase().startsWith(p));
    if (found) return found;
  }
  return emails[0];
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

function extractMetaDescription(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i);
  return m ? m[1].trim() : "";
}

function extractPhone(html) {
  let text = html.replace(/<[^>]+>/g, " ");
  const phoneRe = /(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g;
  const matches = text.match(phoneRe);
  return matches ? matches[0].replace(/\s+/g, " ").trim() : "";
}
