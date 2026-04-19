const { STEPS, getSession, clearSession } = require('../state');

async function handleCancel(ctx) {
  const userId = ctx.from.id;
  const session = getSession(userId);

  const activeSteps = [STEPS.AWAITING_NAME, STEPS.AWAITING_AMOUNT, STEPS.AWAITING_PAYMENT, STEPS.AWAITING_PROOF];
  if (!activeSteps.includes(session.step)) {
    return ctx.reply('ℹ️ Нет активной заявки для отмены.\n\n/start — подать заявку\n/status — ваш статус');
  }

  clearSession(userId);
  await ctx.reply(
    '❌ *Регистрация отменена.*\n\n' +
    'Все введённые данные удалены.\n\n' +
    'Когда будете готовы — используйте /start',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleCancel };
