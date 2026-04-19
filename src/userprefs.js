const prefs = new Map(); // userId -> { lang }

function getLang(userId) {
  return prefs.get(String(userId))?.lang || 'ru';
}

function setLang(userId, lang) {
  const cur = prefs.get(String(userId)) || {};
  prefs.set(String(userId), { ...cur, lang });
}

module.exports = { getLang, setLang };
