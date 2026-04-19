const { getStats, healthCheck, getQueueLimit, setQueueLimit } = require('../sheets');

const startTime = Date.now();

function isAdmin(userId) {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).includes(String(userId));
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}д ${h % 24}ч`;
  if (h > 0) return `${h}ч ${m % 60}м`;
  return `${m}м ${s % 60}с`;
}

async function handleHealth(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  let sheetsOk = false;
  let sheetsLatency = 0;
  try {
    const t = Date.now();
    await healthCheck();
    sheetsLatency = Date.now() - t;
    sheetsOk = true;
  } catch {}

  let stats = null;
  try { stats = await getStats(); } catch {}

  const limit = await getQueueLimit().catch(() => null);
  const uptime = formatUptime(Date.now() - startTime);

  await ctx.reply(
    `🖥 *Статус бота*\n` +
    `${'━'.repeat(28)}\n\n` +
    `⏱ Uptime: *${uptime}*\n` +
    `🌐 Google Sheets: ${sheetsOk ? `✅ OK (${sheetsLatency}мс)` : '❌ Недоступен'}\n\n` +
    (stats
      ? `📊 *Данные:*\n` +
        `  👤 Всего заявок: ${stats.totalDonors}\n` +
        `  ⏳ Pending: ${stats.pendingCount}\n` +
        `  ✅ Одобрено: ${stats.approvedCount}\n` +
        `  💸 Paid: ${stats.totalDonors - stats.approvedCount - stats.pendingCount - stats.rejectedCount}\n` +
        `  ❌ Отклонено: ${stats.rejectedCount}\n\n`
      : '') +
    `🔢 Лимит очереди: ${limit ? `*${limit} чел.*` : 'не установлен'}\n` +
    `💰 Одобрено: *${stats ? stats.totalApprovedAmount.toLocaleString('ru-RU') + ' ₸' : '—'}*\n\n` +
    `${'━'.repeat(28)}\n` +
    `/setlimit <N> — установить лимит очереди`,
    { parse_mode: 'Markdown' }
  );
}

async function handleSetLimit(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const current = await getQueueLimit().catch(() => null);
    return ctx.reply(
      `🔢 *Лимит очереди:* ${current ? `${current} чел.` : 'не установлен'}\n\n` +
      `Чтобы установить: /setlimit 20\n` +
      `Чтобы снять: /setlimit 0`,
      { parse_mode: 'Markdown' }
    );
  }

  const n = parseInt(args[1]);
  if (isNaN(n) || n < 0) return ctx.reply('❌ Введите целое число ≥ 0. Пример: /setlimit 20');

  const ok = await setQueueLimit(n === 0 ? '' : n).catch(() => false);
  if (!ok) return ctx.reply('❌ Не удалось сохранить. Убедитесь что лист "Config" существует.');

  await ctx.reply(
    n === 0
      ? '✅ Лимит снят — очередь не ограничена.'
      : `✅ *Лимит установлен: ${n} чел.*\n\nПри достижении лимита новые заявки приниматься не будут.`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleHealth, handleSetLimit };
