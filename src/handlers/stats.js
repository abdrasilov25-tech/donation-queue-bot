const { getStats } = require('../sheets');

async function handleBalance(ctx) {
  try {
    const s = await getStats();

    const recentLines = s.recentApproved.length > 0
      ? s.recentApproved.map((e) => `  ✅ ${e.name} — *${e.amount} ₸* (${e.paymentMethod}) — ${e.date}`).join('\n')
      : '  пока нет';

    await ctx.reply(
      `📊 *ПУБЛИЧНЫЙ СЧЁТ СИСТЕМЫ*\n` +
      `${'━'.repeat(28)}\n\n` +
      `💰 *Одобрено донаций:* ${s.totalApprovedAmount.toLocaleString('ru-RU')} ₸\n` +
      `👥 *Участников в очереди:* ${s.approvedCount}\n` +
      `⏳ *Ожидают проверки:* ${s.pendingCount}\n` +
      `📈 *Средняя донация:* ${s.avgAmount.toLocaleString('ru-RU')} ₸\n\n` +
      `${'━'.repeat(28)}\n` +
      `🕐 *Последние подтверждённые:*\n` +
      recentLines + '\n\n' +
      `${'━'.repeat(28)}\n` +
      `🔍 Все данные хранятся в открытой таблице.\n` +
      `Используйте /queue чтобы увидеть полную очередь.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Balance error:', err);
    await ctx.reply('❌ Не удалось загрузить данные. Попробуйте позже.');
  }
}

async function handleStats(ctx) {
  try {
    const s = await getStats();

    await ctx.reply(
      `📈 *СТАТИСТИКА*\n\n` +
      `👤 Всего заявок: ${s.totalDonors}\n` +
      `✅ Одобрено: ${s.approvedCount}\n` +
      `⏳ На проверке: ${s.pendingCount}\n` +
      `❌ Отклонено: ${s.rejectedCount}\n\n` +
      `💰 Сумма одобренных: *${s.totalApprovedAmount.toLocaleString('ru-RU')} ₸*\n` +
      `📊 Средняя донация: ${s.avgAmount.toLocaleString('ru-RU')} ₸`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Stats error:', err);
    await ctx.reply('❌ Ошибка при загрузке статистики.');
  }
}

module.exports = { handleBalance, handleStats };
