const { getApprovedQueue } = require('../sheets');

async function handleQueue(ctx) {
  try {
    const queue = await getApprovedQueue();

    if (queue.length === 0) {
      return ctx.reply('📭 Очередь пуста. Одобренных донаций пока нет.');
    }

    const totalAmount = queue.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

    const lines = queue.map(
      (e) => `*#${e.position}* ${e.name} — ${parseFloat(e.amount).toLocaleString('ru-RU')} ₸ (${e.paymentMethod})`
    );

    await ctx.reply(
      `📋 *Очередь (${queue.length} чел.):*\n\n` +
      lines.join('\n') +
      `\n\n${'━'.repeat(28)}\n` +
      `💰 Итого: *${totalAmount.toLocaleString('ru-RU')} ₸*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Queue error:', err);
    await ctx.reply('❌ Не удалось загрузить очередь. Попробуйте позже.');
  }
}

module.exports = { handleQueue };
