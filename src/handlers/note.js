const { addNote } = require('../sheets');

function isAdmin(userId) {
  return (process.env.ADMIN_IDS || '').split(',').map((id) => id.trim()).includes(String(userId));
}

async function handleNote(ctx) {
  if (!isAdmin(ctx.from.id)) return ctx.reply('🚫 Нет доступа.');

  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    return ctx.reply(
      '📝 *Заметка к заявке*\n\n' +
      'Использование: `/note <user_id> <текст>`\n\n' +
      'Пример:\n`/note 123456789 проверено лично 15.04`',
      { parse_mode: 'Markdown' }
    );
  }

  const targetId = args[1].trim();
  const note = args.slice(2).join(' ').trim();

  try {
    const result = await addNote(targetId, note);
    if (!result) return ctx.reply(`❌ Пользователь \`${targetId}\` не найден.`, { parse_mode: 'Markdown' });

    await ctx.reply(
      `✅ *Заметка добавлена*\n\n` +
      `👤 ${result.name}\n` +
      `📝 ${note}\n\n` +
      `Заметка сохранена в таблице (столбец J).`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Note error:', err);
    await ctx.reply('❌ Ошибка при сохранении заметки.');
  }
}

module.exports = { handleNote };
