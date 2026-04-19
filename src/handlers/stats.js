const { getStats, getGoal, setGoal } = require('../sheets');

function progressBar(current, goal, length = 16) {
  const pct = Math.min(current / goal, 1);
  const filled = Math.round(pct * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${Math.round(pct * 100)}%`;
}

function isAdmin(userId) {
  return (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).includes(String(userId));
}

async function handleBalance(ctx) {
  try {
    const [s, goal] = await Promise.all([getStats(), getGoal()]);

    const recentLines = s.recentApproved.length > 0
      ? s.recentApproved.map(e => `  ✅ ${e.name} — *${parseFloat(e.amount).toLocaleString('ru-RU')} ₸* (${e.paymentMethod}) — ${e.date}`).join('\n')
      : '  пока нет';

    const goalLine = goal
      ? `\n🎯 *Цель:* ${goal.toLocaleString('ru-RU')} ₸\n` +
        `\`${progressBar(s.totalApprovedAmount, goal)}\`\n` +
        `Собрано ${s.totalApprovedAmount.toLocaleString('ru-RU')} из ${goal.toLocaleString('ru-RU')} ₸\n`
      : '';

    await ctx.reply(
      `📊 *ПУБЛИЧНЫЙ СЧЁТ СИСТЕМЫ*\n` +
      `${'━'.repeat(28)}\n\n` +
      `💵 *Общая сумма заявок:* ${s.totalAllAmount.toLocaleString('ru-RU')} ₸\n` +
      `✅ *Одобрено:* ${s.totalApprovedAmount.toLocaleString('ru-RU')} ₸\n` +
      `👥 *В очереди:* ${s.approvedCount} чел.\n` +
      `⏳ *Ожидают проверки:* ${s.pendingCount} чел.\n` +
      `📈 *Средняя донация:* ${s.avgAmount.toLocaleString('ru-RU')} ₸\n` +
      (goalLine ? `\n${goalLine}` : '') +
      `\n${'━'.repeat(28)}\n` +
      `🕐 *Последние подтверждённые:*\n${recentLines}\n\n` +
      `${'━'.repeat(28)}\n` +
      `🔍 Данные хранятся в открытой таблице:\n` +
      (process.env.SPREADSHEET_URL ? `📎 ${process.env.SPREADSHEET_URL}\n` : '') +
      `/queue — полная очередь`,
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
      `💵 Общая сумма заявок: *${s.totalAllAmount.toLocaleString('ru-RU')} ₸*\n` +
      `💰 Сумма одобренных: *${s.totalApprovedAmount.toLocaleString('ru-RU')} ₸*\n` +
      `📊 Средняя донация: ${s.avgAmount.toLocaleString('ru-RU')} ₸`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Stats error:', err);
    await ctx.reply('❌ Ошибка при загрузке статистики.');
  }
}

async function handleSetGoal(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const current = await getGoal();
    return ctx.reply(
      `🎯 *Текущая цель:* ${current ? current.toLocaleString('ru-RU') + ' ₸' : 'не установлена'}\n\n` +
      `Чтобы установить: /setgoal 500000`,
      { parse_mode: 'Markdown' }
    );
  }

  const amount = parseFloat(args[1].replace(/[^0-9.]/g, ''));
  if (isNaN(amount) || amount <= 0) return ctx.reply('❌ Введите корректную сумму. Пример: /setgoal 500000');

  // Create Config sheet if needed and set goal
  const ok = await setGoal(amount);
  if (!ok) {
    return ctx.reply(
      '⚠️ Не удалось сохранить цель в Sheets.\n\n' +
      'Создайте лист "Config" в вашей таблице вручную и попробуйте снова.'
    );
  }

  await ctx.reply(
    `✅ *Цель установлена: ${amount.toLocaleString('ru-RU')} ₸*\n\n` +
    `Прогресс будет виден в /balance`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleBalance, handleStats, handleSetGoal };
