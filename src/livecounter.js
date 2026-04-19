const { getStats, getGoal, getLiveCounter, setLiveCounter } = require('./sheets');

function progressBar(current, goal, length = 20) {
  const pct = Math.min(current / goal, 1);
  const filled = Math.round(pct * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled) + ` ${Math.round(pct * 100)}%`;
}

function buildCounterText(stats, goal) {
  const pct = goal ? Math.min(stats.totalApprovedAmount / goal, 1) : null;
  const bar = goal ? progressBar(stats.totalApprovedAmount, goal) : null;

  return (
    `💰 *ЖИВОЙ СЧЁТЧИК СБОРА*\n` +
    `${'━'.repeat(30)}\n\n` +
    (goal
      ? `🎯 Цель: *${goal.toLocaleString('ru-RU')} ₸*\n` +
        `\`${bar}\`\n` +
        `Собрано: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* из ${goal.toLocaleString('ru-RU')} ₸\n`
      : `✅ Собрано: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸*\n`) +
    `\n` +
    `👥 Участников: *${stats.approvedCount}*\n` +
    `⏳ На проверке: ${stats.pendingCount}\n` +
    `📈 Средняя донация: ${stats.avgAmount.toLocaleString('ru-RU')} ₸\n` +
    `\n${'━'.repeat(30)}\n` +
    `🕐 Обновлено: ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
  );
}

// Called after every approval — silently updates the pinned message
async function refreshLiveCounter(telegram) {
  try {
    const ref = await getLiveCounter();
    if (!ref) return;

    const [stats, goal] = await Promise.all([getStats(), getGoal()]);
    const text = buildCounterText(stats, goal);

    await telegram.editMessageText(ref.chatId, ref.messageId, null, text, {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    // Message may have been deleted or bot lost admin — don't crash
    if (!err.message?.includes('message is not modified')) {
      console.warn('LiveCounter update failed:', err.message);
    }
  }
}

// Posts initial counter message, pins it, saves reference
async function startLiveCounter(telegram, chatId) {
  const [stats, goal] = await Promise.all([getStats(), getGoal()]);
  const text = buildCounterText(stats, goal);

  const msg = await telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  await setLiveCounter(chatId, msg.message_id);

  try {
    await telegram.pinChatMessage(chatId, msg.message_id, { disable_notification: true });
  } catch {
    // Bot may not have pin permission — ok, message still posted
  }

  return msg.message_id;
}

module.exports = { refreshLiveCounter, startLiveCounter, buildCounterText };
