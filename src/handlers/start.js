const { Markup } = require('telegraf');
const { STEPS, getSession, setStep, setData, clearSession, isRateLimited } = require('../state');
const { addDonation, userExists, getStats, checkDuplicate } = require('../sheets');

function getAdminIds() {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
}

async function handleStart(ctx) {
  const userId = ctx.from.id;

  try {
    const exists = await userExists(userId);

    if (exists) {
      return ctx.reply(
        '✅ Вы уже зарегистрированы!\n\n' +
        'Используйте:\n/status — ваш статус\n/queue — очередь\n/balance — общий счёт'
      );
    }
  } catch (err) {
    console.error('userExists error:', err.message);
    // Continue even if sheets fails — let user register
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
        return ctx.reply(`❌ Минимальная сумма донации — ${MIN_AMOUNT.toLocaleString('ru-RU')} ₸`);
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
  const fileId = photo[photo.length - 1].file_id; // highest resolution

  await ctx.reply('📸 Скриншот получен! Отправляю на проверку...');
  await submitDonation(ctx, userId, session, '', fileId);
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
  await ctx.reply(
    '📸 *Отправьте скриншот подтверждения оплаты*\n\n' +
    'Без доказательства заявка не будет сохранена.\n\n' +
    'Можно отправить:\n' +
    '• 📷 Скриншот из Kaspi / банка\n' +
    '• 🖼 Фото чека\n' +
    '• 🔗 Ссылку на перевод (текстом)',
    { parse_mode: 'Markdown' }
  );
}

async function handleSkipProof(ctx) {
  // Proof is now mandatory — skip is no longer allowed
  await ctx.answerCbQuery('❌ Доказательство обязательно', { show_alert: true });
}

async function submitDonation(ctx, userId, session, proofLink, proofPhotoId) {
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

    await addDonation({
      userId,
      name: session.data.name,
      amount: session.data.amount,
      paymentMethod: session.data.paymentMethod,
      proofLink: proofPhotoId ? `[фото:${proofPhotoId}]` : proofLink,
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
    await notifyAdmins(ctx, userId, session, proofLink, proofPhotoId);
  } catch (err) {
    console.error('Submit error:', err);
    await ctx.reply('❌ Ошибка при сохранении. Попробуйте позже.');
  }
}

async function notifyAdmins(ctx, userId, session, proofLink, proofPhotoId) {
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
