/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

type Env = {
  BOT_TOKEN: string;
  TELEGRAM_SECRET?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: unknown;
};

type TelegramMessage = {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
    title?: string;
    username?: string;
    first_name?: string;
  };
  date: number;
  text?: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response("tg-dice-worker is running.");
    }

    if (url.pathname !== "/webhook") {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (env.TELEGRAM_SECRET) {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");

      if (secret !== env.TELEGRAM_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let update: TelegramUpdate;

    try {
      update = await request.json<TelegramUpdate>();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const message = update.message;

    if (!message || !message.text) {
      return new Response("ok");
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    try {
      const reply = handleCommand(text);

      if (reply) {
        await sendMessage(env.BOT_TOKEN, {
          chat_id: chatId,
          text: reply,
          reply_to_message_id: message.message_id
        });
      }
    } catch (error) {
      await sendMessage(env.BOT_TOKEN, {
        chat_id: chatId,
        text: "骰娘出错了，请稍后再试。",
        reply_to_message_id: message.message_id
      });

      console.error(error);
    }

    return new Response("ok");
  }
};

function handleCommand(text: string): string | null {
  if (text === "/start") {
    return [
      "骰娘已启动。",
      "",
      "可用指令：",
      ".r 1d100",
      ".r 2d6+3",
      ".ra 侦查 60",
      ".help"
    ].join("\n");
  }

  if (text === "/help" || text === ".help") {
    return [
      "骰娘帮助：",
      "",
      ".r 1d100",
      ".r 2d6+3",
      ".r 1d20+5",
      ".ra 侦查 60",
      "",
      "当前版本支持基础掷骰和简单 COC 检定。"
    ].join("\n");
  }

  if (/^\.r(?:\s+.*)?$/i.test(text)) {
    const expr = text.replace(/^\.r\s*/i, "").trim() || "1d100";
    const result = rollDice(expr);

    return `掷骰：${expr}\n结果：${result}`;
  }

  if (/^\.ra\s+/i.test(text)) {
    return handleCocCheck(text);
  }

  return null;
}

function handleCocCheck(text: string): string {
  const match = text.match(/^\.ra\s+(.+?)\s+(\d+)$/i);

  if (!match) {
    return "格式错误。示例：.ra 侦查 60";
  }

  const skillName = match[1].trim();
  const skillValue = Number(match[2]);

  if (!Number.isInteger(skillValue) || skillValue < 1 || skillValue > 100) {
    return "技能值需要是 1 到 100 之间的整数。";
  }

  const roll = randomInt(1, 100);
  const result = cocSuccessLevel(roll, skillValue);

  return `${skillName} 检定：1d100 = ${roll} / ${skillValue}\n结果：${result}`;
}

function rollDice(expr: string): string {
  const normalized = expr.replace(/\s+/g, "");
  const match = normalized.match(/^(\d*)d(\d+)([+-]\d+)?$/i);

  if (!match) {
    return "暂不支持该骰子表达式。目前支持：1d100、2d6+3、1d20-1";
  }

  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const mod = Number(match[3] || 0);

  if (!Number.isInteger(count) || !Number.isInteger(sides) || !Number.isInteger(mod)) {
    return "骰子表达式错误。";
  }

  if (count <= 0 || count > 100) {
    return "骰子数量超出限制，范围为 1 到 100。";
  }

  if (sides <= 1 || sides > 100000) {
    return "骰子面数超出限制，范围为 2 到 100000。";
  }

  const rolls: number[] = [];

  for (let i = 0; i < count; i++) {
    rolls.push(randomInt(1, sides));
  }

  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + mod;

  const modText = mod === 0 ? "" : mod > 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`;

  return `${rolls.join(" + ")}${modText} = ${total}`;
}

function cocSuccessLevel(roll: number, skill: number): string {
  if (roll === 1) {
    return "大成功";
  }

  const extreme = Math.floor(skill / 5);
  const hard = Math.floor(skill / 2);

  if (roll <= extreme) {
    return "极难成功";
  }

  if (roll <= hard) {
    return "困难成功";
  }

  if (roll <= skill) {
    return "普通成功";
  }

  if (skill < 50 && roll >= 96) {
    return "大失败";
  }

  if (skill >= 50 && roll === 100) {
    return "大失败";
  }

  return "失败";
}

function randomInt(min: number, max: number): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);

  return min + (array[0] % (max - min + 1));
}

async function sendMessage(
  token: string,
  body: {
    chat_id: number | string;
    text: string;
    reply_to_message_id?: number;
  }
): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram sendMessage failed: ${response.status} ${errorText}`);
  }
}
