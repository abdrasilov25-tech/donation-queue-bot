const { getTopDonors } = require('../sheets');

async function handleTop(ctx) {
  try {
    const donors = await getTopDonors(10);

    if (donors.length === 0) {
      return ctx.reply('📭 Пока нет одобренных донаций.');
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = donors.map((d, i) => {
      const medal = medals[i] || `${i + 1}.`;
      const statusMark = d.status === 'paid' ? ' ✓' : '';
      return `${medal} *${d.name}*${statusMark} — ${d.amount.toLocaleString('ru-RU')} ₸`;
    });

    await ctx.reply(
      `🏆 *Топ доноров*\n` +
      `${'━'.repeat(28)}\n\n` +
      lines.join('\n') +
      `\n\n${'━'.repeat(28)}\n` +
      `✓ — выплата получена\n` +
      `/balance — общий счёт системы`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Top error:', err);
    await ctx.reply('❌ Не удалось загрузить топ. Попробуйте позже.');
  }
}

module.exports = { handleTop };
