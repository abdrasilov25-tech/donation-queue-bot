const { startLiveCounter } = require('../livecounter');
const { getLiveCounter, setLiveCounter } = require('../sheets');

function isAdmin(userId) {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).includes(String(userId));
}

async function handleStartCounter(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  // If used in a group directly — use that chat
  // If used in private — require chat_id argument
  let chatId;
  if (ctx.chat.type === 'private') {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply(
        '📌 *Живой счётчик*\n\n' +
        'Добавьте бота в группу/канал как администратора, затем:\n\n' +
        '• Напишите `/startcounter` прямо в той группе\n' +
        '• Или: `/startcounter <chat_id>` из личных сообщений\n\n' +
        'Бот закрепит сообщение и будет обновлять его при каждом одобрении.\n\n' +
        '💡 Сначала установите цель: `/setgoal 1000000`',
        { parse_mode: 'Markdown' }
      );
    }
    chatId = args[1].trim();
  } else {
    chatId = ctx.chat.id;
  }

  try {
    await ctx.reply('⏳ Создаю счётчик...');
    const msgId = await startLiveCounter(ctx.telegram, chatId);
    await ctx.reply(
      `✅ *Живой счётчик запущен!*\n\n` +
      `Сообщение закреплено (ID: ${msgId})\n` +
      `Будет обновляться автоматически при каждом одобрении донации.\n\n` +
      `Чтобы остановить: /stopcounter`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('StartCounter error:', err);
    await ctx.reply(
      `❌ Ошибка: ${err.message}\n\n` +
      `Убедитесь что бот добавлен в группу/канал как администратор.`
    );
  }
}

async function handleStopCounter(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  const ref = await getLiveCounter().catch(() => null);
  if (!ref) return ctx.reply('ℹ️ Живой счётчик не запущен.');

  await setLiveCounter('', '');
  await ctx.reply('⏹ *Живой счётчик остановлен.*\n\nСообщение в чате не удалено — его можно открепить вручную.', { parse_mode: 'Markdown' });
}

module.exports = { handleStartCounter, handleStopCounter };
