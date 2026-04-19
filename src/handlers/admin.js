const { updateStatus, getUserStatus, getPendingUsers, getStats } = require('../sheets');

function getAdminIds() {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function isAdmin(userId) {
  return getAdminIds().includes(String(userId));
}

function requireAdmin(ctx) {
  if (!isAdmin(ctx.from.id)) {
    ctx.reply('🚫 У вас нет прав для этой команды.');
    return false;
  }
  return true;
}

// Broadcast public transparency message to group chat if bot is in one
async function broadcastApproval(ctx, info, result) {
  const groupId = process.env.GROUP_CHAT_ID;
  const publicMsg =
    `🎉 *Новая донация подтверждена!*\n\n` +
    `👤 ${info.name}\n` +
    `💰 *${parseFloat(info.amount).toLocaleString('ru-RU')} ₸*\n` +
    `💳 ${info.paymentMethod}\n` +
    `📍 Позиция в очереди: *#${result.queuePosition}*\n\n` +
    `Используйте /balance чтобы увидеть общий счёт.`;

  if (groupId) {
    try {
      await ctx.telegram.sendMessage(groupId, publicMsg, { parse_mode: 'Markdown' });
    } catch (e) {
      console.warn('Could not broadcast to group:', e.message);
    }
  }
}

async function handleApprove(ctx) {
  if (!requireAdmin(ctx)) return;

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('❌ Использование: /approve <user_id>');
  }

  const targetUserId = args[1].trim();

  try {
    const userInfo = await getUserStatus(targetUserId);
    if (!userInfo) return ctx.reply(`❌ Пользователь с ID ${targetUserId} не найден.`);
    if (userInfo.status === 'approved') {
      return ctx.reply(`ℹ️ ${userInfo.name} уже одобрен (позиция #${userInfo.queuePosition}).`);
    }

    const result = await updateStatus(targetUserId, 'approved');
    const stats = await getStats();

    await ctx.reply(
      `✅ *Одобрено!*\n\n` +
      `👤 ${userInfo.name}\n` +
      `💰 ${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸\n` +
      `📍 Позиция: #${result.queuePosition}\n\n` +
      `📊 Итого одобрено: *${stats.totalApprovedAmount.toLocaleString('ru-RU')} ₸* (${stats.approvedCount} чел.)`,
      { parse_mode: 'Markdown' }
    );

    await broadcastApproval(ctx, userInfo, result);

    // Notify user
    try {
      await ctx.telegram.sendMessage(
        targetUserId,
        `🎉 *Ваша донация одобрена!*\n\n` +
        `💰 Сумма: ${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸\n` +
        `📍 Ваша позиция в очереди: *#${result.queuePosition}*\n\n` +
        `Используйте:\n/queue — увидеть всю очередь\n/balance — публичный счёт системы`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      // User may have blocked the bot
    }
  } catch (err) {
    console.error('Approve error:', err);
    await ctx.reply('❌ Ошибка при обновлении статуса.');
  }
}

async function handleReject(ctx) {
  if (!requireAdmin(ctx)) return;

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('❌ Использование: /reject <user_id>');
  }

  const targetUserId = args[1].trim();

  try {
    const userInfo = await getUserStatus(targetUserId);
    if (!userInfo) return ctx.reply(`❌ Пользователь с ID ${targetUserId} не найден.`);

    await updateStatus(targetUserId, 'rejected');

    await ctx.reply(
      `❌ *Отклонено.*\n\n👤 ${userInfo.name} — ${parseFloat(userInfo.amount).toLocaleString('ru-RU')} ₸`,
      { parse_mode: 'Markdown' }
    );

    try {
      await ctx.telegram.sendMessage(
        targetUserId,
        `❌ Ваша заявка была отклонена.\n\nОбратитесь к администратору за подробностями.`
      );
    } catch {
      // ignored
    }
  } catch (err) {
    console.error('Reject error:', err);
    await ctx.reply('❌ Ошибка при обновлении статуса.');
  }
}

async function handlePending(ctx) {
  if (!requireAdmin(ctx)) return;

  try {
    const pending = await getPendingUsers();

    if (pending.length === 0) {
      return ctx.reply('✅ Нет заявок, ожидающих проверки.');
    }

    const lines = pending.map((u, i) =>
      `${i + 1}. *${u.name}* — ${parseFloat(u.amount).toLocaleString('ru-RU')} ₸ (${u.paymentMethod})\n` +
      `   ID: \`${u.userId}\`` +
      (u.proofLink ? `\n   📎 ${u.proofLink}` : '')
    );

    await ctx.reply(
      `⏳ *Ожидают проверки (${pending.length}):*\n\n` + lines.join('\n\n') + '\n\n' +
      `Используйте:\n/approve <id> — одобрить\n/reject <id> — отклонить`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Pending error:', err);
    await ctx.reply('❌ Ошибка при загрузке.');
  }
}

async function handleAdminHelp(ctx) {
  if (!requireAdmin(ctx)) return;

  await ctx.reply(
    '🔧 *Команды администратора:*\n\n' +
    '/pending — список ожидающих проверки\n' +
    '/approve <user\\_id> — одобрить\n' +
    '/reject <user\\_id> — отклонить\n' +
    '/queue — полная очередь\n' +
    '/stats — статистика\n' +
    '/balance — публичный счёт\n\n' +
    '💡 user\\_id виден в /pending',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleApprove, handleReject, handlePending, handleAdminHelp, isAdmin };
