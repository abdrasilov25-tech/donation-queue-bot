const { getAllUsersForBroadcast } = require('../sheets');

function isAdmin(userId) {
  return (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).includes(String(userId));
}

async function handleBroadcast(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  const text = ctx.message.text.replace('/broadcast', '').trim();
  if (!text) {
    return ctx.reply(
      '❌ Использование:\n/broadcast Ваше сообщение\n\n' +
      'Пример:\n/broadcast Уважаемые участники! Выплаты идут по расписанию.'
    );
  }

  await ctx.reply('📤 Начинаю рассылку...');

  const users = await getAllUsersForBroadcast();
  let sent = 0, failed = 0;

  const msg = `📢 *Сообщение от администратора:*\n\n${text}`;

  for (const user of users) {
    try {
      await ctx.telegram.sendMessage(user.userId, msg, { parse_mode: 'Markdown' });
      sent++;
      // Small delay to avoid Telegram rate limit
      await new Promise(r => setTimeout(r, 100));
    } catch {
      failed++;
    }
  }

  await ctx.reply(
    `✅ *Рассылка завершена*\n\n` +
    `📨 Отправлено: ${sent}\n` +
    `❌ Не доставлено: ${failed} (заблокировали бота)`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleBroadcast };
