const { searchByName } = require('../sheets');

function isAdmin(userId) {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).includes(String(userId));
}

const STATUS_EMOJI = {
  pending: '⏳', approved: '✅', rejected: '❌',
  awaiting_confirm: '💸', paid: '💰',
};

async function handleSearch(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('❌ Использование: /search <имя>\n\nПример: /search Асель');
  }

  const query = args.slice(1).join(' ').trim();
  if (query.length < 2) return ctx.reply('❌ Введите минимум 2 символа.');

  try {
    const results = await searchByName(query);

    if (results.length === 0) {
      return ctx.reply(`🔍 Пользователи с именем "*${query}*" не найдены.`, { parse_mode: 'Markdown' });
    }

    const lines = results.map((u) => {
      const emoji = STATUS_EMOJI[u.status] || '❓';
      const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('ru-RU') : '—';
      return (
        `${emoji} *${u.name}*\n` +
        `   💰 ${parseFloat(u.amount).toLocaleString('ru-RU')} ₸ · ${u.paymentMethod}\n` +
        `   🆔 \`${u.userId}\` · ${date}` +
        (u.status === 'approved' ? ` · #${u.queuePosition}` : '')
      );
    });

    await ctx.reply(
      `🔍 *Найдено: ${results.length}*\n\n` + lines.join('\n\n'),
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Search error:', err);
    await ctx.reply('❌ Ошибка при поиске.');
  }
}

module.exports = { handleSearch };
