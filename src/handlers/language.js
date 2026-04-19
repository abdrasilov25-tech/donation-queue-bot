const { Markup } = require('telegraf');
const { setLang, getLang } = require('../userprefs');
const { t } = require('../lang');

async function handleLang(ctx) {
  await ctx.reply(
    t(getLang(ctx.from.id), 'langSelect'),
    Markup.inlineKeyboard([
      [Markup.button.callback('🇷🇺 Русский', 'lang_ru')],
      [Markup.button.callback('🇰🇿 Қазақша', 'lang_kz')],
    ])
  );
}

async function handleLangCallback(ctx) {
  const lang = ctx.callbackQuery.data === 'lang_kz' ? 'kz' : 'ru';
  setLang(ctx.from.id, lang);
  await ctx.answerCbQuery();
  await ctx.editMessageText(t(lang, 'langSet'));
}

module.exports = { handleLang, handleLangCallback };
