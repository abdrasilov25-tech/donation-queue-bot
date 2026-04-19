const { Markup } = require('telegraf');
const { STEPS, getSession, setStep, setData, clearSession } = require('../state');
const { addDonation, userExists } = require('../sheets');

async function handleStart(ctx) {
  const userId = ctx.from.id;
  const exists = await userExists(userId);

  if (exists) {
    return ctx.reply(
      '✅ Вы уже зарегистрированы!\n\nИспользуйте:\n/status — ваш статус\n/queue — очередь\n/list — список донаций'
    );
  }

  clearSession(userId);
  setStep(userId, STEPS.AWAITING_NAME);

  await ctx.reply(
    '👋 Добро пожаловать в систему взаимопомощи!\n\n' +
    'Давайте зарегистрируем вашу донацию.\n\n' +
    '📝 Введите ваше имя:'
  );
}

async function handleMessage(ctx) {
  const userId = ctx.from.id;
  const session = getSession(userId);
  const text = ctx.message.text?.trim();

  if (!text) return;

  switch (session.step) {
    case STEPS.AWAITING_NAME: {
      if (text.length < 2) return ctx.reply('❌ Имя слишком короткое. Попробуйте снова:');
      setData(userId, 'name', text);
      setStep(userId, STEPS.AWAITING_AMOUNT);
      return ctx.reply('💰 Введите сумму донации (только цифры, например: 5000):');
    }

    case STEPS.AWAITING_AMOUNT: {
      const amount = parseFloat(text.replace(/[^0-9.]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('❌ Введите корректную сумму (только цифры). Например: 5000');
      }
      setData(userId, 'amount', amount);
      setStep(userId, STEPS.AWAITING_PAYMENT);
      return ctx.reply(
        '💳 Выберите способ оплаты:',
        Markup.inlineKeyboard([
          [Markup.button.callback('Kaspi', 'pay_kaspi')],
          [Markup.button.callback('Банковская карта', 'pay_card')],
          [Markup.button.callback('Наличные', 'pay_cash')],
        ])
      );
    }

    case STEPS.AWAITING_PROOF: {
      let proofLink = '';
      if (text && text !== 'Пропустить') {
        // Accept URL or any text as proof
        proofLink = text;
      }
      await submitDonation(ctx, userId, session, proofLink);
      break;
    }

    default:
      break;
  }
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
    '🔗 Отправьте ссылку на подтверждение оплаты (скриншот, чек и т.д.)\n' +
    'Или нажмите «Пропустить»:',
    Markup.inlineKeyboard([[Markup.button.callback('Пропустить', 'skip_proof')]])
  );
}

async function handleSkipProof(ctx) {
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (session.step !== STEPS.AWAITING_PROOF) return ctx.answerCbQuery();

  await ctx.answerCbQuery();
  await ctx.editMessageText('📎 Подтверждение: не указано');
  await submitDonation(ctx, userId, session, '');
}

async function submitDonation(ctx, userId, session, proofLink) {
  try {
    await addDonation({
      userId,
      name: session.data.name,
      amount: session.data.amount,
      paymentMethod: session.data.paymentMethod,
      proofLink,
    });

    setStep(userId, STEPS.DONE);

    await ctx.reply(
      '✅ Ваша заявка принята!\n\n' +
      `👤 Имя: ${session.data.name}\n` +
      `💰 Сумма: ${session.data.amount} ₸\n` +
      `💳 Способ: ${session.data.paymentMethod}\n\n` +
      '⏳ Статус: *ожидает проверки*\n\n' +
      'После одобрения администратором вы войдёте в очередь.\n' +
      'Используйте /status чтобы проверить статус.',
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Submit error:', err);
    await ctx.reply('❌ Ошибка при сохранении. Попробуйте позже или обратитесь к администратору.');
  }
}

module.exports = { handleStart, handleMessage, handlePaymentChoice, handleSkipProof };
