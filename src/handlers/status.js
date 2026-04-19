const { getUserStatus } = require('../sheets');

const STATUS_EMOJI = {
  pending: '⏳',
  approved: '✅',
  rejected: '❌',
};

const STATUS_TEXT = {
  pending: 'Ожидает проверки',
  approved: 'Одобрено',
  rejected: 'Отклонено',
};

async function handleStatus(ctx) {
  const userId = ctx.from.id;

  try {
    const info = await getUserStatus(userId);

    if (!info) {
      return ctx.reply(
        '❓ Вы ещё не зарегистрированы.\nИспользуйте /start чтобы подать заявку.'
      );
    }

    const emoji = STATUS_EMOJI[info.status] || '❓';
    const statusText = STATUS_TEXT[info.status] || info.status;
    const queueLine =
      info.status === 'approved'
        ? `\n📍 Позиция в очереди: *#${info.queuePosition}*`
        : '';

    await ctx.reply(
      `📊 *Ваш статус:*\n\n` +
      `👤 Имя: ${info.name}\n` +
      `💰 Сумма: ${info.amount} ₸\n` +
      `💳 Способ: ${info.paymentMethod}\n` +
      `${emoji} Статус: *${statusText}*` +
      queueLine,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Status error:', err);
    await ctx.reply('❌ Не удалось получить статус. Попробуйте позже.');
  }
}

module.exports = { handleStatus };
