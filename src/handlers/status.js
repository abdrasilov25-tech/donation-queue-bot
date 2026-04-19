const { getUserStatus, getAvgPayoutInterval } = require('../sheets');

const STATUS_EMOJI = {
  pending: '⏳',
  approved: '✅',
  rejected: '❌',
  awaiting_confirm: '💸',
  paid: '💰',
};

const STATUS_TEXT = {
  pending: 'Ожидает проверки',
  approved: 'Одобрено — в очереди',
  rejected: 'Отклонено',
  awaiting_confirm: 'Выплата отправлена — подтвердите',
  paid: 'Выплачено',
};

async function handleStatus(ctx) {
  const userId = ctx.from.id;

  try {
    const info = await getUserStatus(userId);

    if (!info) {
      return ctx.reply('❓ Вы ещё не зарегистрированы.\nИспользуйте /start чтобы подать заявку.');
    }

    const emoji = STATUS_EMOJI[info.status] || '❓';
    const statusText = STATUS_TEXT[info.status] || info.status;

    let queueLine = '';
    let etaLine = '';

    if (info.status === 'approved') {
      queueLine = `\n📍 Позиция в очереди: *#${info.queuePosition}*`;

      // Estimate wait time
      const avgDays = await getAvgPayoutInterval().catch(() => null);
      if (avgDays && info.queuePosition && info.queuePosition !== '—') {
        const pos = parseInt(info.queuePosition);
        if (!isNaN(pos) && pos > 0) {
          const estDays = Math.round(pos * avgDays);
          etaLine = `\n⏱ Примерное ожидание: *~${estDays} дн.* (по истории выплат)`;
        }
      }
    }

    if (info.status === 'awaiting_confirm') {
      queueLine = `\n\n👉 Подтвердите получение: /confirm`;
    }

    if (info.status === 'rejected') {
      queueLine = `\n\n🔄 Повторная подача: /resubmit`;
    }

    const createdLine = info.createdAt
      ? `\n📅 Подано: ${new Date(info.createdAt).toLocaleDateString('ru-RU')}`
      : '';

    await ctx.reply(
      `📊 *Ваш статус:*\n\n` +
      `👤 Имя: ${info.name}\n` +
      `💰 Сумма: *${parseFloat(info.amount).toLocaleString('ru-RU')} ₸*\n` +
      `💳 Способ: ${info.paymentMethod}\n` +
      `${emoji} Статус: *${statusText}*` +
      queueLine +
      etaLine +
      createdLine +
      (info.status === 'pending' ? '\n\n✏️ /edit amount 5000 — изменить сумму\n✏️ /edit method Kaspi — изменить способ' : ''),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Status error:', err);
    await ctx.reply('❌ Не удалось получить статус. Попробуйте позже.');
  }
}

module.exports = { handleStatus };
