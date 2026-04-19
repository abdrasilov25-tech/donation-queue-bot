const cron = require('node-cron');
const { getPendingOlderThan, getApprovedActiveUsers } = require('./sheets');

function getAdminIds() {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function startScheduler(bot) {
  // Every 2 hours: remind admin about pending submissions older than 24h
  cron.schedule('0 */2 * * *', async () => {
    try {
      const stale = await getPendingOlderThan(24);
      if (stale.length === 0) return;

      const lines = stale.map((u, i) => {
        const hours = Math.floor((Date.now() - new Date(u.createdAt).getTime()) / 3600000);
        return `${i + 1}. *${u.name}* — ${parseFloat(u.amount).toLocaleString('ru-RU')} ₸\n   ⏰ Ждёт ${hours}ч | ID: \`${u.userId}\``;
      });

      const msg =
        `⚠️ *Ожидают проверки более 24 часов:*\n\n` +
        lines.join('\n\n') +
        `\n\n👉 Используйте /pending чтобы одобрить или отклонить`;

      for (const adminId of getAdminIds()) {
        await bot.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }

      console.log(`⏰ Reminded admins about ${stale.length} stale pending submissions`);
    } catch (err) {
      console.error('Scheduler reminder error:', err.message);
    }
  });

  // Every day at 09:00: morning summary to admin
  cron.schedule('0 9 * * *', async () => {
    try {
      const { getStats } = require('./sheets');
      const stats = await getStats();
      const queue = await getApprovedActiveUsers();

      const msg =
        `☀️ *Утренняя сводка*\n\n` +
        `💰 Собрано: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸*\n` +
        `👥 В очереди: ${stats.approvedCount}\n` +
        `⏳ Ожидают: ${stats.pendingCount}\n` +
        `📈 Средняя донация: ${stats.avgAmount.toLocaleString('ru-RU')} ₸\n\n` +
        (stats.pendingCount > 0
          ? `⚠️ *${stats.pendingCount} заявок ждут проверки* → /pending`
          : `✅ Все заявки проверены`);

      for (const adminId of getAdminIds()) {
        await bot.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }
    } catch (err) {
      console.error('Scheduler daily summary error:', err.message);
    }
  });

  console.log('⏰ Scheduler started');
}

// Notify all approved users when queue moves (called after /paid)
async function notifyQueueMove(bot, paidName, paidPosition) {
  try {
    const active = await getApprovedActiveUsers();

    for (const user of active) {
      if (user.effectivePosition <= 3) {
        // Only notify top 3 — others don't need to know yet
        const msg =
          `📣 *Очередь движется!*\n\n` +
          `✅ *${paidName}* (позиция #${paidPosition}) получил выплату\n\n` +
          `📍 Ваша текущая позиция: *#${user.effectivePosition}*\n` +
          (user.effectivePosition === 1
            ? `\n🔥 *Вы первые в очереди!* Ожидайте выплату.`
            : `\nЕщё ${user.effectivePosition - 1} чел. впереди вас.`);

        await bot.telegram.sendMessage(user.userId, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('notifyQueueMove error:', err.message);
  }
}

module.exports = { startScheduler, notifyQueueMove };
