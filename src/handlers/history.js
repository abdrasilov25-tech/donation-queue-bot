const { getUserHistory } = require('../sheets');

const STATUS_EMOJI = {
  pending: '⏳', approved: '✅', rejected: '❌',
  awaiting_confirm: '💸', paid: '💰',
};

async function handleHistory(ctx) {
  const userId = ctx.from.id;

  try {
    const history = await getUserHistory(userId);

    if (history.length === 0) {
      return ctx.reply('📭 У вас нет заявок в системе.\n\n/start — подать первую заявку');
    }

    const lines = history.map((h, i) => {
      const emoji = STATUS_EMOJI[h.status] || '❓';
      const date = h.createdAt ? new Date(h.createdAt).toLocaleDateString('ru-RU') : '—';
      const paidDate = h.paidAt ? ` → выплачено ${new Date(h.paidAt).toLocaleDateString('ru-RU')}` : '';
      return (
        `*${i + 1}.* ${emoji} ${parseFloat(h.amount).toLocaleString('ru-RU')} ₸ · ${h.paymentMethod}\n` +
        `   📅 ${date}${paidDate}`
      );
    });

    const totalPaid = history
      .filter((h) => h.status === 'paid')
      .reduce((s, h) => s + (parseFloat(h.amount) || 0), 0);

    await ctx.reply(
      `📋 *История ваших заявок*\n` +
      `${'━'.repeat(28)}\n\n` +
      lines.join('\n\n') +
      (totalPaid > 0
        ? `\n\n${'━'.repeat(28)}\n💸 Всего получено: *${totalPaid.toLocaleString('ru-RU')} ₸*`
        : ''),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('History error:', err);
    await ctx.reply('❌ Не удалось загрузить историю. Попробуйте позже.');
  }
}

module.exports = { handleHistory };
