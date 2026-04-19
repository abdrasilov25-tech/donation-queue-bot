const { getPauseState, setPauseState } = require('../sheets');

function isAdmin(userId) {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).includes(String(userId));
}

async function handlePause(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  const args = ctx.message.text.split(' ');
  const reason = args.slice(1).join(' ').trim();

  const current = await getPauseState().catch(() => ({ paused: false }));
  if (current.paused) {
    return ctx.reply(
      `⏸ Приём уже приостановлен.\n\nПричина: ${current.reason || 'не указана'}\n\n/resume — возобновить`
    );
  }

  const ok = await setPauseState(true, reason || 'технические работы').catch(() => false);
  if (!ok) return ctx.reply('❌ Не удалось сохранить. Убедитесь что лист "Config" существует.');

  await ctx.reply(
    `⏸ *Приём заявок приостановлен*\n\n` +
    `📝 Причина: *${reason || 'технические работы'}*\n\n` +
    `Пользователи при /start будут видеть сообщение о паузе.\n` +
    `/resume — возобновить приём`,
    { parse_mode: 'Markdown' }
  );
}

async function handleResume(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  const current = await getPauseState().catch(() => ({ paused: false }));
  if (!current.paused) {
    return ctx.reply('✅ Приём заявок уже активен.');
  }

  const ok = await setPauseState(false, '').catch(() => false);
  if (!ok) return ctx.reply('❌ Ошибка при возобновлении.');

  await ctx.reply(
    `▶️ *Приём заявок возобновлён*\n\nПользователи снова могут подавать заявки через /start`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handlePause, handleResume };
