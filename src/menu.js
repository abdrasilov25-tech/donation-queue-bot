const { Markup } = require('telegraf');

function mainMenu() {
  return Markup.keyboard([
    ['📝 Подать заявку', '📊 Мой статус'],
    ['💰 Баланс',        '📋 Очередь'],
    ['❓ FAQ',           '🔗 Моя ссылка'],
  ]).resize().persistent();
}

module.exports = { mainMenu };
