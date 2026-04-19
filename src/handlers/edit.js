const { Markup } = require('telegraf');
const { editDonationField, getUserStatus } = require('../sheets');

const PAYMENT_METHODS = ['Kaspi', 'Банковская карта', 'Наличные'];
const MIN_AMOUNT = 100;
const MAX_AMOUNT = 5_000_000;

async function handleEdit(ctx) {
  const userId = ctx.from.id;
  const args = ctx.message.text.split(' ');

  if (args.length < 3) {
    return ctx.reply(
      '✏️ *Редактирование заявки*\n\n' +
      'Доступно только пока заявка ожидает проверки.\n\n' +
      '*Команды:*\n' +
      '`/edit amount 8000` — изменить сумму\n' +
      '`/edit method Kaspi` — изменить способ оплаты\n\n' +
      '*Способы оплаты:* Kaspi, Банковская карта, Наличные',
      { parse_mode: 'Markdown' }
    );
  }

  const field = args[1].toLowerCase();
  const value = args.slice(2).join(' ').trim();

  if (field === 'amount') {
    const amount = parseFloat(value.replace(/[^0-9.]/g, ''));
    if (isNaN(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return ctx.reply(`❌ Некорректная сумма. Диапазон: ${MIN_AMOUNT.toLocaleString('ru-RU')} — ${MAX_AMOUNT.toLocaleString('ru-RU')} ₸`);
    }

    const result = await editDonationField(userId, 'amount', amount).catch(() => null);
    if (!result) return ctx.reply('❓ Заявка не найдена. Используйте /start');
    if (result.notPending) return ctx.reply('⚠️ Редактировать можно только заявки со статусом *ожидает проверки*.', { parse_mode: 'Markdown' });

    return ctx.reply(
      `✅ *Сумма обновлена*\n\n` +
      `💰 Новая сумма: *${amount.toLocaleString('ru-RU')} ₸*\n\n` +
      `Используйте /status чтобы проверить заявку.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (field === 'method') {
    const matched = PAYMENT_METHODS.find((m) => m.toLowerCase() === value.toLowerCase());
    if (!matched) {
      return ctx.reply(
        `❌ Неизвестный способ: *${value}*\n\nДоступные: ${PAYMENT_METHODS.join(', ')}`,
        { parse_mode: 'Markdown' }
      );
    }

    const result = await editDonationField(userId, 'paymentMethod', matched).catch(() => null);
    if (!result) return ctx.reply('❓ Заявка не найдена. Используйте /start');
    if (result.notPending) return ctx.reply('⚠️ Редактировать можно только заявки со статусом *ожидает проверки*.', { parse_mode: 'Markdown' });

    return ctx.reply(
      `✅ *Способ оплаты обновлён*\n\n` +
      `💳 Новый способ: *${matched}*\n\n` +
      `Используйте /status чтобы проверить заявку.`,
      { parse_mode: 'Markdown' }
    );
  }

  return ctx.reply(
    '❌ Неизвестное поле. Используйте:\n`/edit amount <сумма>`\n`/edit method <способ>`',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleEdit };
