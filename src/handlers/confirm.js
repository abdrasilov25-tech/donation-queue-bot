const { confirmReceipt } = require('../sheets');

async function handleConfirm(ctx) {
  const userId = ctx.from.id;

  let result;
  try {
    result = await confirmReceipt(userId);
  } catch (err) {
    console.error('Confirm error:', err);
    return ctx.reply('❌ Ошибка. Попробуйте позже.');
  }

  if (!result) {
    return ctx.reply('❓ Ваша заявка не найдена. Используйте /start');
  }

  if (result.status && !result.confirmed) {
    const statusMap = {
      pending: '⏳ Ваша заявка ещё ожидает одобрения.',
      approved: '✅ Ваша заявка одобрена, но выплата ещё не отправлена.',
      paid: '💸 Вы уже подтверждали получение ранее.',
      rejected: '❌ Ваша заявка отклонена.',
    };
    return ctx.reply(statusMap[result.status] || `Статус: ${result.status}`);
  }

  await ctx.reply(
    `✅ *Получение подтверждено!*\n\n` +
    `👤 ${result.name}\n` +
    `💰 ${parseFloat(result.amount).toLocaleString('ru-RU')} ₸\n` +
    `📋 Позиция в очереди: #${result.queuePosition}\n\n` +
    `Спасибо за участие! Данные обновлены в таблице.`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleConfirm };
