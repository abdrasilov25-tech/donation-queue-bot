const { getOrCreateRef } = require('../referral');

async function handleRef(ctx) {
  const userId = ctx.from.id;
  const username = ctx.botInfo?.username;
  if (!username) return ctx.reply('❌ Не удалось получить имя бота.');

  const ref = getOrCreateRef(userId);
  const link = `https://t.me/${username}?start=${ref.code}`;
  const count = ref.referrals.length;

  await ctx.reply(
    `🔗 *Ваша реферальная ссылка:*\n\n` +
    `\`${link}\`\n\n` +
    `👥 Приглашено друзей: *${count}*\n\n` +
    `Поделитесь ссылкой — когда друг подаст заявку через неё, это отобразится в вашем профиле.`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleRef };
