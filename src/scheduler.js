const cron = require('node-cron');
const { getApprovedActiveUsers, getStats, healthCheck, createBackup, getNotifyPref } = require('./sheets');
const { getAllPending } = require('./pending');
const { cleanupStaleSessions } = require('./state');

const remindedUsers = new Set(); // avoid duplicate 48h reminders

function getAdminIds() {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function startScheduler(bot) {
  // Every 2 hours: remind admin about pending submissions older than 24h
  cron.schedule('0 */2 * * *', async () => {
    try {
      const now = Date.now();
      const stale = getAllPending().filter((u) => now - new Date(u.createdAt).getTime() > 24 * 3600000);
      if (stale.length === 0) return;

      const lines = stale.map((u, i) => {
        const hours = Math.floor((now - new Date(u.createdAt).getTime()) / 3600000);
        return `${i + 1}. *${u.name}* — ${parseFloat(u.amount).toLocaleString('ru-RU')} ₸\n   ⏰ Ждёт ${hours}ч | ID: \`${u.userId}\``;
      });

      const msg =
        `⚠️ *Ожидают проверки более 24 часов:*\n\n` +
        lines.join('\n\n') +
        `\n\n👉 /pending — одобрить или отклонить`;

      for (const adminId of getAdminIds()) {
        await bot.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }

      console.log(`⏰ Reminded admins about ${stale.length} stale pending submissions`);
    } catch (err) {
      console.error('Scheduler reminder error:', err.message);
    }
  });

  // Every 6 hours: remind users whose submission has been pending >48h
  cron.schedule('0 */6 * * *', async () => {
    try {
      const now = Date.now();
      const old = getAllPending().filter((u) => now - new Date(u.createdAt).getTime() > 48 * 3600000);
      for (const u of old) {
        if (remindedUsers.has(u.userId)) continue;
        await bot.telegram.sendMessage(
          u.userId,
          `⏳ *Ваша заявка всё ещё на проверке*\n\n` +
          `Мы получили вашу заявку на *${parseFloat(u.amount).toLocaleString('ru-RU')} ₸* и скоро её рассмотрим.\n\n` +
          `/status — посмотреть текущий статус`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
        remindedUsers.add(u.userId);
      }
    } catch (err) {
      console.error('User reminder error:', err.message);
    }
  });

  // Every day at 09:00: morning summary to admin
  cron.schedule('0 9 * * *', async () => {
    try {
      const stats = await getStats();

      const msg =
        `☀️ *Утренняя сводка*\n\n` +
        `💵 Общая сумма заявок: *${stats.totalAllAmount.toLocaleString('ru-RU')} ₸*\n` +
        `✅ Одобрено: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸*\n` +
        `👥 В очереди: ${stats.approvedCount}\n` +
        `⏳ Ожидают: ${stats.pendingCount}\n` +
        `❌ Отклонено: ${stats.rejectedCount}\n` +
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

  // Every 30 minutes: health check Google Sheets
  cron.schedule('*/30 * * * *', async () => {
    try {
      await healthCheck();
      console.log('✅ Sheets health check OK');
    } catch (err) {
      console.error('❌ Sheets health check FAILED:', err.message);
      for (const adminId of getAdminIds()) {
        await bot.telegram.sendMessage(
          adminId,
          `🚨 *Проблема с Google Sheets!*\n\n${err.message}\n\nДанные могут не сохраняться. Проверьте доступ.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }
  });

  // Every Monday at 09:00: weekly report to admin
  cron.schedule('0 9 * * 1', async () => {
    try {
      const stats = await getStats();

      // Calculate this week's metrics
      const { getAllRowsRaw } = require('./sheets');
      const rows = await getAllRowsRaw();
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekRows = rows.slice(1).filter((r) => new Date(r[7]).getTime() > weekAgo);
      const weekApproved = weekRows.filter((r) => ['approved', 'awaiting_confirm', 'paid'].includes(r[5]));
      const weekAmount = weekApproved.reduce((s, r) => s + (parseFloat(r[2]) || 0), 0);

      const msg =
        `📅 *Еженедельный отчёт*\n` +
        `${'━'.repeat(28)}\n\n` +
        `*За последние 7 дней:*\n` +
        `📥 Новых заявок: ${weekRows.length}\n` +
        `✅ Одобрено: ${weekApproved.length}\n` +
        `💰 Сумма за неделю: *${weekAmount.toLocaleString('ru-RU')} ₸*\n\n` +
        `*Всего в системе:*\n` +
        `💵 Общая сумма: *${stats.totalAllAmount.toLocaleString('ru-RU')} ₸*\n` +
        `✅ Одобрено: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸*\n` +
        `👥 В очереди: ${stats.approvedCount}\n` +
        `⏳ Ожидают: ${stats.pendingCount}\n` +
        `📈 Средняя донация: ${stats.avgAmount.toLocaleString('ru-RU')} ₸\n\n` +
        (stats.pendingCount > 0 ? `⚠️ *${stats.pendingCount} заявок ждут проверки* → /pending` : `✅ Все заявки обработаны`);

      for (const adminId of getAdminIds()) {
        await bot.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' }).catch(() => {});
      }
      console.log('📅 Weekly report sent');
    } catch (err) {
      console.error('Weekly report error:', err.message);
    }
  });

  // Every day at 02:00: nightly backup
  cron.schedule('0 2 * * *', async () => {
    try {
      const sheetName = await createBackup();
      console.log(`✅ Nightly backup created: ${sheetName}`);
    } catch (err) {
      console.error('Nightly backup error:', err.message);
      for (const adminId of getAdminIds()) {
        await bot.telegram.sendMessage(
          adminId,
          `⚠️ *Ошибка ночного бэкапа*\n\n${err.message}`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }
  });

  // Every 15 minutes: clean up stale user sessions
  cron.schedule('*/15 * * * *', () => {
    try {
      cleanupStaleSessions();
    } catch (err) {
      console.error('Session cleanup error:', err.message);
    }
  });

  console.log('⏰ Scheduler started (reminders, daily summary, health check, backup, session cleanup)');
}

// Notify all approved users when queue moves (called after /paid)
async function notifyQueueMove(bot, paidName, paidPosition) {
  try {
    const active = await getApprovedActiveUsers();

    for (const user of active) {
      if (user.effectivePosition <= 3) {
        const notifyOn = await getNotifyPref(user.userId).catch(() => true);
        if (!notifyOn) continue;

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
