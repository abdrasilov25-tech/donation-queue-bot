const { Markup } = require('telegraf');
const { STEPS, getSession, setStep, setData, clearSession, isRateLimited } = require('../state');
const { userExists, getPaidUser, getStats, checkDuplicate, checkPhotoDuplicate, isUserBanned, getApprovedCount, getQueueLimit, getPauseState } = require('../sheets');
const { setPending, hasPending } = require('../pending');
const { recordReferral } = require('../referral');
const { addToWaitlist, isOnWaitlist, getWaitlistPosition } = require('../waitlist');
const { getLang } = require('../userprefs');
const { t } = require('../lang');
const { mainMenu } = require('../menu');

function getAdminIds() {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
}

async function handleJoinWaitlist(ctx) {
  const userId = ctx.from.id;
  const name = ctx.from.first_name || 'Участник';
  const lang = getLang(userId);

  if (isOnWaitlist(userId)) {
    const pos = getWaitlistPosition(userId);
    await ctx.answerCbQuery();
    return ctx.reply(t(lang, 'alreadyWaiting', pos), { parse_mode: 'Markdown' });
  }

  addToWaitlist(userId, name);
  const pos = getWaitlistPosition(userId);
  await ctx.answerCbQuery('✅');
  await ctx.reply(
    `📋 *Вы добавлены в лист ожидания!*\n\nВаша позиция: *#${pos}*\n\nКак только в очереди освободится место — вы получите уведомление.`,
    { parse_mode: 'Markdown' }
  );
}

// Called when user taps "Начать регистрацию" on the onboarding card
async function handleStartRegistration(ctx) {
  const userId = ctx.from.id;
  const lang = getLang(userId);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  clearSession(userId);
  setStep(userId, STEPS.AWAITING_NAME);
  await ctx.reply(t(lang, 'askName'), mainMenu());
}

async function handleStart(ctx) {
  const userId = ctx.from.id;
  const lang = getLang(userId);

  // Track referral from start payload
  const payload = ctx.startPayload;
  if (payload && payload.startsWith('ref_')) {
    recordReferral(userId, payload);
  }

  try {
    const banned = await isUserBanned(userId).catch(() => false);
    if (banned) {
      return ctx.reply(t(lang, 'banned'));
    }

    const pauseState = await getPauseState().catch(() => ({ paused: false }));
    if (pauseState.paused) {
      return ctx.reply(t(lang, 'paused', pauseState.reason), { parse_mode: 'Markdown' });
    }

    const [limit, approvedCount] = await Promise.all([
      getQueueLimit().catch(() => null),
      getApprovedCount().catch(() => 0),
    ]);
    if (limit && approvedCount >= limit) {
      const alreadyWaiting = isOnWaitlist(userId);
      const waitPos = alreadyWaiting ? getWaitlistPosition(userId) : null;
      return ctx.reply(
        alreadyWaiting
          ? t(lang, 'alreadyWaiting', waitPos)
          : t(lang, 'queueFull', approvedCount, limit),
        {
          parse_mode: 'Markdown',
          ...(!alreadyWaiting
            ? Markup.inlineKeyboard([[Markup.button.callback('📋 Встать в лист ожидания', 'join_waitlist')]])
            : {}),
        }
      );
    }

    // Returning donor
    const paidUser = await getPaidUser(userId).catch(() => null);
    if (paidUser) {
      clearSession(userId);
      setData(userId, 'name', paidUser.name);
      setData(userId, 'amount', paidUser.amount);
      setData(userId, 'paymentMethod', paidUser.paymentMethod);
      setData(userId, 'isRepeat', true);
      setStep(userId, STEPS.AWAITING_PROOF);
      return ctx.reply(
        `👋 *С возвращением, ${paidUser.name}!*\n\n` +
        `Ваши данные:\n💰 ${parseFloat(paidUser.amount).toLocaleString('ru-RU')} ₸\n💳 ${paidUser.paymentMethod}\n\n` +
        `📸 Отправьте скриншот нового перевода для повторной заявки:`,
        { parse_mode: 'Markdown' }
      );
    }

    if (hasPending(userId)) {
      return ctx.reply(t(lang, 'alreadyPending'), mainMenu());
    }

    const exists = await userExists(userId);
    if (exists) {
      return ctx.reply(t(lang, 'alreadyRegistered'), mainMenu());
    }
  } catch (err) {
    console.error('handleStart error:', err.message);
  }

  // New user — show onboarding card
  const stats = await getStats().catch(() => null);
  const totalLine = stats
    ? `\n💰 Уже собрано: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} участников)\n`
    : '';

  await ctx.reply(
    t(lang, 'onboarding', totalLine),
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'startBtn'), 'start_registration')]]),
    }
  );
}

const MIN_AMOUNT = 100;
const MAX_AMOUNT = 5_000_000;
const MAX_NAME_LEN = 60;

async function handleMessage(ctx) {
  const userId = ctx.from.id;
  if (isRateLimited(userId)) return;

  const session = getSession(userId);
  const text = ctx.message.text?.trim();
  if (!text) return;

  const lang = getLang(userId);

  // Route main menu button taps — lazy-require to avoid circular deps
  if (text === '📝 Подать заявку') return handleStart(ctx);
  if (text === '📊 Мой статус')    return require('./status').handleStatus(ctx);
  if (text === '💰 Баланс')        return require('./stats').handleBalance(ctx);
  if (text === '📋 Очередь')       return require('./queue').handleQueue(ctx);
  if (text === '❓ FAQ')           return require('./faq').handleFaq(ctx);
  if (text === '🔗 Моя ссылка')   return require('./ref').handleRef(ctx);

  switch (session.step) {
    case STEPS.AWAITING_NAME: {
      if (text.length < 2) return ctx.reply(t(lang, 'nameTooShort'));
      if (text.length > MAX_NAME_LEN) return ctx.reply(t(lang, 'nameTooLong', MAX_NAME_LEN));
      setData(userId, 'name', text.replace(/[<>]/g, ''));
      setStep(userId, STEPS.AWAITING_AMOUNT);
      return ctx.reply(t(lang, 'askAmount'));
    }

    case STEPS.AWAITING_AMOUNT: {
      const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (isNaN(amount) || amount <= 0) return ctx.reply(t(lang, 'invalidAmount'));
      if (amount < MIN_AMOUNT) return ctx.reply(t(lang, 'minAmount', MIN_AMOUNT), { parse_mode: 'HTML' });
      if (amount > MAX_AMOUNT) return ctx.reply(t(lang, 'maxAmount', MAX_AMOUNT));
      setData(userId, 'amount', amount);
      setStep(userId, STEPS.AWAITING_PAYMENT);
      return ctx.reply(
        t(lang, 'choosePayment'),
        Markup.inlineKeyboard([
          [Markup.button.callback('📱 Kaspi', 'pay_kaspi')],
          [Markup.button.callback('💳 Банковская карта', 'pay_card')],
          [Markup.button.callback('💵 Наличные', 'pay_cash')],
        ])
      );
    }

    case STEPS.AWAITING_PROOF: {
      if (text.length < 5) return ctx.reply('❌ Слишком коротко. Отправьте скриншот или ссылку на перевод.');
      await submitDonation(ctx, userId, session, text, null);
      break;
    }

    default:
      break;
  }
}

async function handlePhotoProof(ctx) {
  const userId = ctx.from.id;
  const session = getSession(userId);
  if (session.step !== STEPS.AWAITING_PROOF) return;

  const photo = ctx.message.photo;
  const best = photo[photo.length - 1];
  const fileId = best.file_id;
  const fileUniqueId = best.file_unique_id;

  const photoDup = await checkPhotoDuplicate(userId, fileUniqueId).catch(() => null);
  if (photoDup) {
    for (const adminId of getAdminIds()) {
      await ctx.telegram.sendMessage(
        adminId,
        `🚨 *Одинаковый скриншот!*\n\nПользователь *${session.data.name}* (ID: \`${userId}\`) прислал тот же скриншот, что и *${photoDup.name}* (ID: \`${photoDup.userId}\`).\n\nВозможное мошенничество!`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  }

  await ctx.reply('📸 Скриншот получен! Отправляю на проверку...');
  await submitDonation(ctx, userId, session, '', fileId, fileUniqueId);
}

async function handlePaymentChoice(ctx) {
  const userId = ctx.from.id;
  const session = getSession(userId);
  if (session.step !== STEPS.AWAITING_PAYMENT) return ctx.answerCbQuery();

  const paymentMap = { pay_kaspi: 'Kaspi', pay_card: 'Банковская карта', pay_cash: 'Наличные' };
  const method = paymentMap[ctx.callbackQuery.data];
  if (!method) return ctx.answerCbQuery();

  setData(userId, 'paymentMethod', method);
  setStep(userId, STEPS.AWAITING_PROOF);
  await ctx.answerCbQuery();
  await ctx.editMessageText(`✅ Способ оплаты: ${method}`);

  const amountStr = parseFloat(session.data.amount).toLocaleString('ru-RU');
  const detailsHtml = method === 'Наличные'
    ? `💵 <b>Наличные</b>\n\nСвяжитесь с администратором для передачи наличных.\nСумма: <b>${amountStr} ₸</b>`
    : `📱 <b>Kaspi</b>\nНомер: <code>87712472645</code>\nПолучатель: <b>Назипа А.</b>\n\nСумма к переводу: <b>${amountStr} ₸</b>\n\n⚠️ В комментарии укажите своё имя.`;

  await ctx.reply(
    `💳 <b>Реквизиты для перевода:</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${detailsHtml}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📸 После перевода отправьте скриншот сюда:`,
    { parse_mode: 'HTML' }
  );
}

async function handleSkipProof(ctx) {
  await ctx.answerCbQuery('❌ Доказательство обязательно', { show_alert: true });
}

async function submitDonation(ctx, userId, session, proofLink, proofPhotoId, fileUniqueId = null) {
  try {
    const duplicate = await checkDuplicate(userId, session.data.amount, session.data.paymentMethod).catch(() => null);
    if (duplicate) {
      for (const adminId of getAdminIds()) {
        await ctx.telegram.sendMessage(
          adminId,
          `⚠️ *Возможный дубль!*\n\nНовая заявка от *${session.data.name}* (ID: \`${userId}\`) на *${parseFloat(session.data.amount).toLocaleString('ru-RU')} ₸* (${session.data.paymentMethod})\nсовпадает с заявкой от *${duplicate.name}* за последние 24ч.\n\nПроверьте перед одобрением!`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }

    const proofValue = proofPhotoId
      ? `[фото:${proofPhotoId}${fileUniqueId ? '|' + fileUniqueId : ''}]`
      : proofLink;

    setPending(userId, {
      name: session.data.name,
      amount: session.data.amount,
      paymentMethod: session.data.paymentMethod,
      proofLink: proofValue,
      isRepeat: session.data.isRepeat || false,
    });

    setStep(userId, STEPS.DONE);

    const stats = await getStats().catch(() => null);
    const totalLine = stats
      ? `\n📊 Общий счёт: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} одобрено)\n`
      : '';

    await ctx.reply(
      '✅ *Заявка принята!*\n\n' +
      `👤 Имя: ${session.data.name}\n` +
      `💰 Сумма: ${parseFloat(session.data.amount).toLocaleString('ru-RU')} ₸\n` +
      `💳 Способ: ${session.data.paymentMethod}\n` +
      `📎 Доказательство: ${proofPhotoId ? '📸 фото' : proofLink || 'не указано'}\n\n` +
      '⏳ Статус: *ожидает проверки*\n' +
      totalLine +
      '\nВы получите уведомление после проверки.',
      { parse_mode: 'Markdown', ...mainMenu() }
    );

    await notifyAdmins(ctx, userId, session, proofLink, proofPhotoId, fileUniqueId);
  } catch (err) {
    console.error('Submit error:', err);
    await ctx.reply('❌ Ошибка при сохранении. Попробуйте позже.');
  }
}

async function notifyAdmins(ctx, userId, session, proofLink, proofPhotoId, fileUniqueId = null) {
  const adminIds = getAdminIds();
  if (adminIds.length === 0) return;

  const caption =
    `🔔 *Новая заявка на проверку!*\n\n` +
    `👤 ${session.data.name}\n` +
    `💰 *${parseFloat(session.data.amount).toLocaleString('ru-RU')} ₸*\n` +
    `💳 ${session.data.paymentMethod}\n` +
    `🆔 ID: \`${userId}\`\n` +
    (proofLink ? `🔗 ${proofLink}` : proofPhotoId ? '📸 Скриншот ниже' : '⚠️ Без доказательства');

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Одобрить', `adm_approve_${userId}`), Markup.button.callback('❌ Отклонить', `adm_reject_${userId}`)],
  ]);

  for (const adminId of adminIds) {
    try {
      if (proofPhotoId) {
        await ctx.telegram.sendPhoto(adminId, proofPhotoId, { caption, parse_mode: 'Markdown', ...keyboard });
      } else {
        await ctx.telegram.sendMessage(adminId, caption, { parse_mode: 'Markdown', ...keyboard });
      }
    } catch (e) {
      console.warn(`Could not notify admin ${adminId}:`, e.message);
    }
  }
}

module.exports = {
  handleStart,
  handleMessage,
  handlePhotoProof,
  handlePaymentChoice,
  handleSkipProof,
  handleJoinWaitlist,
  handleStartRegistration,
};
