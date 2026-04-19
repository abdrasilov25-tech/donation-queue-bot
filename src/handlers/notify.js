const { getNotifyPref, setNotifyPref } = require('../sheets');

async function handleNotify(ctx) {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');
  const arg = (args[1] || '').toLowerCase();

  if (!arg || (arg !== 'on' && arg !== 'off')) {
    const current = await getNotifyPref(userId).catch(() => true);
    return ctx.reply(
      `🔔 *Уведомления сейчас:* ${current ? 'включены ✅' : 'выключены 🔕'}\n\n` +
      `/notify on — включить\n` +
      `/notify off — выключить\n\n` +
      `Уведомления включают: обновление позиции в очереди, напоминания.`,
      { parse_mode: 'Markdown' }
    );
  }

  const enabled = arg === 'on';
  await setNotifyPref(userId, enabled);

  await ctx.reply(
    enabled
      ? '🔔 Уведомления *включены*. Вы будете получать обновления о позиции в очереди.'
      : '🔕 Уведомления *выключены*. Важные сообщения (одобрение, выплата) всё равно придут.',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleNotify };
