const { Markup } = require('telegraf');
const { STEPS, getSession, setStep, setData, clearSession, isRateLimited } = require('../state');
const { userExists, getPaidUser, getStats, checkDuplicate, checkPhotoDuplicate, isUserBanned, getApprovedCount, getQueueLimit, getPauseState } = require('../sheets');
const { setPending, hasPending, getPending } = require('../pending');

function getAdminIds() {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
}

async function handleStart(ctx) {
  const userId = ctx.from.id;

  try {
    // Check ban first
    const banned = await isUserBanned(userId).catch(() => false);
    if (banned) {
      return ctx.reply('🚫 Вы заблокированы и не можете подавать заявки.');
    }

    // Check if registrations are paused
    const pauseState = await getPauseState().catch(() => ({ paused: false }));
    if (pauseState.paused) {
      return ctx.reply(
        `⏸ *Приём заявок временно приостановлен*\n\n` +
        `📝 Причина: ${pauseState.reason || 'технические работы'}\n\n` +
        `Попробуйте позже или обратитесь к администратору.`,
        { parse_mode: 'Markdown' }
      );
    }

    // Check queue limit before allowing new registration
    const [limit, approvedCount] = await Promise.all([
      getQueueLimit().catch(() => null),
      getApprovedCount().catch(() => 0),
    ]);
    if (limit && approvedCount >= limit) {
      return ctx.reply(
        `⛔ *Очередь заполнена*\n\n` +
        `Сейчас в очереди *${approvedCount}* из *${limit}* мест.\n\n` +
        `Попробуйте позже или обратитесь к администратору.`,
        { parse_mode: 'Markdown' }
      );
    }

    // Check if returning donor (was paid before)
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
        `Ваши данные:\n` +
        `💰 ${parseFloat(paidUser.amount).toLocaleString('ru-RU')} ₸\n` +
        `💳 ${paidUser.paymentMethod}\n\n` +
        `📸 Отправьте скриншот нового перевода для повторной заявки:`,
        { parse_mode: 'Markdown' }
      );
    }

    // Check if already submitted (pending in memory)
    if (hasPending(userId)) {
      return ctx.reply(
        '⏳ Ваша заявка уже отправлена на проверку.\n\n' +
        'Используйте:\n/status — ваш статус\n/queue — очередь\n/balance — общий счёт'
      );
    }

    const exists = await userExists(userId);
    if (exists) {
      return ctx.reply(
        '✅ Вы уже зарегистрированы!\n\n' +
        'Используйте:\n/status — ваш статус\n/queue — очередь\n/balance — общий счёт'
      );
    }
  } catch (err) {
    console.error('handleStart error:', err.message);
  }

  clearSession(userId);
  setStep(userId, STEPS.AWAITING_NAME);

  const stats = await getStats().catch(() => null);
  const totalLine = stats
    ? `\n💰 Уже собрано: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} участников)\n`
    : '';

  await ctx.reply(
    '👋 Добро пожаловать в систему взаимопомощи!\n' +
    totalLine +
    '\n📝 Введите ваше имя:',
    { parse_mode: 'Markdown' }
  );
}

const MIN_AMOUNT = 100;
const MAX_AMOUNT = 5_000_000;
const MAX_NAME_LEN = 60;

async function handleMessage(ctx) {
  const userId = ctx.from.id;

  if (isRateLimited(userId)) return; // silently drop — too fast

  const session = getSession(userId);
  const text = ctx.message.text?.trim();

  if (!text) return;

  switch (session.step) {
    case STEPS.AWAITING_NAME: {
      if (text.length < 2) return ctx.reply('❌ Имя слишком короткое. Попробуйте снова:');
      if (text.length > MAX_NAME_LEN) return ctx.reply(`❌ Имя слишком длинное (макс. ${MAX_NAME_LEN} символов):`);
      setData(userId, 'name', text.replace(/[<>]/g, ''));
      setStep(userId, STEPS.AWAITING_AMOUNT);
      return ctx.reply('💰 Введите сумму донации (только цифры, например: 5000):');
    }

    case STEPS.AWAITING_AMOUNT: {
      const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('❌ Введите корректную сумму (только цифры). Например: 5000');
      }
      if (amount < MIN_AMOUNT) {
        return ctx.reply(`❌ Минимальная сумма — <b>${MIN_AMOUNT.toLocaleString('ru-RU')} ₸</b>`, { parse_mode: 'HTML' });
      }
      if (amount > MAX_AMOUNT) {
        return ctx.reply(`❌ Максимальная сумма — ${MAX_AMOUNT.toLocaleString('ru-RU')} ₸. Введите корректную сумму:`);
      }
      setData(userId, 'amount', amount);
      setStep(userId, STEPS.AWAITING_PAYMENT);
      return ctx.reply(
        '💳 Выберите способ оплаты:',
        Markup.inlineKeyboard([
          [Markup.button.callback('📱 Kaspi', 'pay_kaspi')],
          [Markup.button.callback('💳 Банковская карта', 'pay_card')],
          [Markup.button.callback('💵 Наличные', 'pay_cash')],
        ])
      );
    }

    case STEPS.AWAITING_PROOF: {
      if (text.length < 5) {
        return ctx.reply('❌ Слишком коротко. Отправьте скриншот или ссылку на перевод.');
      }
      await submitDonation(ctx, userId, session, text, null);
      break;
    }

    default:
      break;
  }
}

// Handle photo proof (screenshot of payment)
async function handlePhotoProof(ctx) {
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (session.step !== STEPS.AWAITING_PROOF) return;

  const photo = ctx.message.photo;
  const best = photo[photo.length - 1];
  const fileId = best.file_id;
  const fileUniqueId = best.file_unique_id;

  // Check if this exact photo was used by another user
  const photoDup = await checkPhotoDuplicate(userId, fileUniqueId).catch(() => null);
  if (photoDup) {
    const adminIds = getAdminIds();
    for (const adminId of adminIds) {
      await ctx.telegram.sendMessage(
        adminId,
        `🚨 *Одинаковый скриншот!*\n\n` +
        `Пользователь *${session.data.name}* (ID: \`${userId}\`) прислал тот же скриншот, что и *${photoDup.name}* (ID: \`${photoDup.userId}\`).\n\n` +
        `Возможное мошенничество — проверьте перед одобрением!`,
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

  const paymentMap = {
    pay_kaspi: 'Kaspi',
    pay_card: 'Банковская карта',
    pay_cash: 'Наличные',
  };

  const method = paymentMap[ctx.callbackQuery.data];
  if (!method) return ctx.answerCbQuery();

  setData(userId, 'paymentMethod', method);
  setStep(userId, STEPS.AWAITING_PROOF);

  await ctx.answerCbQuery();
  await ctx.editMessageText(`✅ Способ оплаты: ${method}`);

  const amount = session.data.amount;
  const amountStr = parseFloat(amount).toLocaleString('ru-RU');

  let detailsHtml;
  if (method === 'Наличные') {
    detailsHtml =
      `💵 <b>Наличные</b>\n\n` +
      `Свяжитесь с администратором для передачи наличных.\n` +
      `Сумма: <b>${amountStr} ₸</b>`;
  } else {
    detailsHtml =
      `📱 <b>Kaspi</b>\n` +
      `Номер: <code>87712472645</code>\n` +
      `Получатель: <b>Назипа А.</b>\n\n` +
      `Сумма к переводу: <b>${amountStr} ₸</b>\n\n` +
      `⚠️ В комментарии к переводу укажите своё имя.`;
  }

  await ctx.reply(
    `💳 <b>Реквизиты для перевода:</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    detailsHtml +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📸 После перевода отправьте скриншот сюда:`,
    { parse_mode: 'HTML' }
  );
}

async function handleSkipProof(ctx) {
  // Proof is now mandatory — skip is no longer allowed
  await ctx.answerCbQuery('❌ Доказательство обязательно', { show_alert: true });
}

async function submitDonation(ctx, userId, session, proofLink, proofPhotoId, fileUniqueId = null) {
  try {
    // Duplicate detection: same amount + method from different user in last 24h
    const duplicate = await checkDuplicate(userId, session.data.amount, session.data.paymentMethod).catch(() => null);
    if (duplicate) {
      const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
      for (const adminId of adminIds) {
        await ctx.telegram.sendMessage(
          adminId,
          `⚠️ *Возможный дубль!*\n\n` +
          `Новая заявка от *${session.data.name}* (ID: \`${userId}\`) на *${parseFloat(session.data.amount).toLocaleString('ru-RU')} ₸* (${session.data.paymentMethod})\n` +
          `совпадает с заявкой от *${duplicate.name}* за последние 24ч.\n\n` +
          `Проверьте внимательно перед одобрением!`,
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

    // Show user confirmation with current total
    const stats = await getStats().catch(() => null);
    const totalLine = stats
      ? `\n📊 Общий счёт системы: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} одобрено)\n`
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
      { parse_mode: 'Markdown' }
    );

    // Notify admin with inline approve/reject buttons
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
    [
      Markup.button.callback('✅ Одобрить', `adm_approve_${userId}`),
      Markup.button.callback('❌ Отклонить', `adm_reject_${userId}`),
    ],
  ]);

  for (const adminId of adminIds) {
    try {
      if (proofPhotoId) {
        await ctx.telegram.sendPhoto(adminId, proofPhotoId, {
          caption,
          parse_mode: 'Markdown',
          ...keyboard,
        });
      } else {
        await ctx.telegram.sendMessage(adminId, caption, {
          parse_mode: 'Markdown',
          ...keyboard,
        });
      }
    } catch (e) {
      console.warn(`Could not notify admin ${adminId}:`, e.message);
    }
  }
}

module.exports = { handleStart, handleMessage, handlePhotoProof, handlePaymentChoice, handleSkipProof };
