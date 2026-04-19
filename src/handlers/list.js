const { getLastApproved } = require('../sheets');

async function handleList(ctx) {
  try {
    const entries = await getLastApproved(10);

    if (entries.length === 0) {
      return ctx.reply('📭 Одобренных донаций пока нет.');
    }

    const lines = entries.map(
      (e) => `#${e.position} *${e.name}* — ${e.amount} ₸`
    );

    await ctx.reply(
      `🏆 *Последние ${entries.length} одобренных донаций:*\n\n` + lines.join('\n'),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('List error:', err);
    await ctx.reply('❌ Не удалось загрузить список. Попробуйте позже.');
  }
}

module.exports = { handleList };
