const { Markup } = require('telegraf');
const { getUserStatus, resetToResubmit } = require('../sheets');
const { STEPS, getSession, setStep, setData, clearSession } = require('../state');

async function handleResubmit(ctx) {
  const userId = ctx.from.id;
  const info = await getUserStatus(userId).catch(() => null);

  if (!info) {
    return ctx.reply('❓ Вы не зарегистрированы. Используйте /start');
  }

  if (info.status === 'pending') {
    return ctx.reply('⏳ Ваша заявка уже ожидает проверки. Используйте /status');
  }

  if (info.status === 'approved') {
    return ctx.reply('✅ Ваша заявка уже одобрена! Используйте /status');
  }

  if (info.status === 'paid') {
    return ctx.reply('💸 Вы уже получили выплату. Для новой заявки используйте /start');
  }

  // status === 'rejected' — allow resubmit
  await resetToResubmit(userId);
  clearSession(userId);
  setStep(userId, STEPS.AWAITING_PROOF);
  setData(userId, 'name', info.name);
  setData(userId, 'amount', info.amount);
  setData(userId, 'paymentMethod', info.paymentMethod);

  await ctx.reply(
    `🔄 *Повторная подача заявки*\n\n` +
    `👤 ${info.name}\n` +
    `💰 ${parseFloat(info.amount).toLocaleString('ru-RU')} ₸\n` +
    `💳 ${info.paymentMethod}\n\n` +
    `📸 Отправьте новый скриншот подтверждения оплаты:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('Пропустить', 'skip_proof')]])
    }
  );
}

module.exports = { handleResubmit };
