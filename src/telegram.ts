import { Bot, InputFile } from 'grammy';
import { IncomingMessage } from './types';

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

const MAX_LEN = 4000;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_LEN) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let current = '';

  for (const para of paragraphs) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length > MAX_LEN) {
      if (current) chunks.push(current);
      current = para.length > MAX_LEN ? para.slice(0, MAX_LEN) : para;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function sendMessage(chatId: string, text: string): Promise<void> {
  for (const chunk of splitMessage(text)) {
    try {
      await bot.api.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
    } catch {
      await bot.api.sendMessage(chatId, chunk);
    }
  }
}

export async function sendDocument(chatId: string, buffer: Buffer, filename: string): Promise<void> {
  await bot.api.sendDocument(chatId, new InputFile(buffer, filename));
}

export function startPolling(onMessage: (msg: IncomingMessage) => Promise<void>): void {
  bot.on('message:text', (ctx) => {
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';

    if (isGroup) {
      const botUsername = ctx.me.username;
      const mentioned = ctx.message.entities?.some(
        e =>
          e.type === 'mention' &&
          ctx.message.text.substring(e.offset, e.offset + e.length) === `@${botUsername}`
      );
      const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
      if (!mentioned && !isReplyToBot) return;
    }

    const text = ctx.message.text.replace(/@\w+/g, '').trim();

    onMessage({
      from: String(ctx.from!.id),
      chatId: String(ctx.chat.id),
      text,
      messageId: String(ctx.message.message_id),
    }).catch(console.error);
  });

  bot.start().catch(console.error);
  console.log('Telegram bot polling started');
}
