import Anthropic from '@anthropic-ai/sdk';
import { Intent } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ADMIN_TOOLS: Anthropic.Tool[] = [
  {
    name: 'add_tasks',
    description: 'הוסף משימות חדשות לרשימה — תמיד השתמש בכלי זה גם אם יש משימה אחת בלבד',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'רשימת משימות להוספה',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'שם המשימה' },
              required_roles: {
                type: 'array',
                items: { type: 'string' },
                description: 'רשימת התפקידים שחייבים לבצע את המשימה. מערך ריק = כולם חייבים.',
              },
            },
            required: ['name', 'required_role'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'remove_task',
    description: 'הסר משימה מהרשימה',
    input_schema: {
      type: 'object',
      properties: {
        task_name: { type: 'string', description: 'שם המשימה להסרה' },
      },
      required: ['task_name'],
    },
  },
  {
    name: 'add_people',
    description: 'הוסף אנשים חדשים לרשימה',
    input_schema: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          description: 'רשימת אנשים להוספה',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'שם מלא' },
              department: { type: 'string', description: 'מחלקה' },
              role: { type: 'string', description: 'תפקיד' },
            },
            required: ['name', 'department', 'role'],
          },
        },
      },
      required: ['people'],
    },
  },
  {
    name: 'remove_person',
    description: 'הסר אדם מהרשימה',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'שם האדם להסרה' },
      },
      required: ['name'],
    },
  },
  {
    name: 'record_completion',
    description: 'רשום שאדם השלים משימה',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'שם האדם' },
        task_name: { type: 'string', description: 'שם המשימה שהושלמה' },
      },
      required: ['person_name', 'task_name'],
    },
  },
  {
    name: 'get_report',
    description: 'הצג דוח על השלמת משימות. אפשר לסנן לפי מחלקה או תפקיד ספציפי באמצעות filter_field ו-filter_value',
    input_schema: {
      type: 'object',
      properties: {
        filter_field: {
          type: 'string',
          enum: ['department', 'role'],
          description: 'שדה לסינון — השתמש כאשר המשתמש מבקש דוח למחלקה או תפקיד ספציפי',
        },
        filter_value: {
          type: 'string',
          description: 'הערך הספציפי לסינון, למשל "מחלקה 3" או "מנהל"',
        },
      },
    },
  },
  {
    name: 'list_people',
    description: 'הצג את רשימת האנשים. השתמש ב-group_by כדי לקבץ לפי שדה (למשל "לפי מחלקה"), ו-filter_field+filter_value כדי לסנן לערך ספציפי (למשל "ממחלקת פיתוח")',
    input_schema: {
      type: 'object',
      properties: {
        group_by: {
          type: 'string',
          enum: ['department', 'role'],
          description: 'קיבוץ כל האנשים לפי שדה זה — השתמש כאשר המשתמש אומר "לפי מחלקה" / "לפי תפקיד" ללא ערך ספציפי',
        },
        filter_field: {
          type: 'string',
          enum: ['department', 'role', 'full_name'],
          description: 'שדה לסינון לערך ספציפי — השתמש יחד עם filter_value',
        },
        filter_value: {
          type: 'string',
          description: 'הערך הספציפי לחיפוש בשדה הנבחר',
        },
      },
    },
  },
  {
    name: 'list_tasks',
    description: 'הצג את רשימת המשימות הרשומות במערכת',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'clear_db',
    description: 'מחק את כל הנתונים במסד הנתונים — אנשים, משימות והשלמות',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'unknown',
    description: 'השתמש בכלי זה כאשר ההודעה אינה ברורה או אינה קשורה לניהול משימות',
    input_schema: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'תשובה בעברית למשתמש' },
      },
      required: ['reply'],
    },
  },
];

const REPORTER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'record_completion',
    description: 'רשום שאדם השלים משימה',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'שם האדם' },
        task_name: { type: 'string', description: 'שם המשימה שהושלמה' },
      },
      required: ['person_name', 'task_name'],
    },
  },
  {
    name: 'get_report',
    description: 'הצג דוח על השלמת משימות. אפשר לסנן לפי מחלקה או תפקיד ספציפי באמצעות filter_field ו-filter_value',
    input_schema: {
      type: 'object',
      properties: {
        filter_field: {
          type: 'string',
          enum: ['department', 'role'],
          description: 'שדה לסינון — השתמש כאשר המשתמש מבקש דוח למחלקה או תפקיד ספציפי',
        },
        filter_value: {
          type: 'string',
          description: 'הערך הספציפי לסינון, למשל "מחלקה 3" או "מנהל"',
        },
      },
    },
  },
  {
    name: 'list_people',
    description: 'הצג את רשימת האנשים. השתמש ב-group_by כדי לקבץ לפי שדה (למשל "לפי מחלקה"), ו-filter_field+filter_value כדי לסנן לערך ספציפי (למשל "ממחלקת פיתוח")',
    input_schema: {
      type: 'object',
      properties: {
        group_by: {
          type: 'string',
          enum: ['department', 'role'],
          description: 'קיבוץ כל האנשים לפי שדה זה — השתמש כאשר המשתמש אומר "לפי מחלקה" / "לפי תפקיד" ללא ערך ספציפי',
        },
        filter_field: {
          type: 'string',
          enum: ['department', 'role', 'full_name'],
          description: 'שדה לסינון לערך ספציפי — השתמש יחד עם filter_value',
        },
        filter_value: {
          type: 'string',
          description: 'הערך הספציפי לחיפוש בשדה הנבחר',
        },
      },
    },
  },
  {
    name: 'list_tasks',
    description: 'הצג את רשימת המשימות הרשומות במערכת',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'unknown',
    description: 'השתמש בכלי זה כאשר ההודעה אינה ברורה או אינה קשורה לניהול משימות',
    input_schema: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'תשובה בעברית למשתמש' },
      },
      required: ['reply'],
    },
  },
];

const ADMIN_SYSTEM = `אתה בוט לניהול משימות. אתה עוזר למנהל לנהל רשימת משימות ואנשים.
כל תשובותיך חייבות להיות בעברית בלבד.
עליך להשתמש תמיד באחד הכלים הזמינים כדי לענות. אל תענה בטקסט ישיר.
אם ההודעה אינה ברורה, השתמש בכלי "unknown" עם הסבר קצר.`;

const REPORTER_SYSTEM = `אתה בוט לניהול משימות. אתה עוזר לדווח על השלמת משימות.
כל תשובותיך חייבות להיות בעברית בלבד.
עליך להשתמש תמיד באחד הכלים הזמינים כדי לענות. אל תענה בטקסט ישיר.
אתה יכול לדווח על השלמת משימה או לקבל דוח. אם ההודעה אינה קשורה לכך, השתמש בכלי "unknown".`;

export async function parseIntent(message: string, isAdmin: boolean): Promise<Intent> {
  const tools = isAdmin ? ADMIN_TOOLS : REPORTER_TOOLS;
  const system = isAdmin ? ADMIN_SYSTEM : REPORTER_SYSTEM;

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system,
    tools,
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: message }],
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

  if (!toolUse) {
    return { type: 'unknown', reply: 'מצטער, לא הצלחתי להבין את הבקשה.' };
  }

  const input = toolUse.input as Record<string, unknown>;

  switch (toolUse.name) {
    case 'add_tasks':
      return { type: 'add_tasks', tasks: input.tasks as Array<{ name: string; required_roles: string[] }> };
    case 'remove_task':
      return { type: 'remove_task', task_name: input.task_name as string };
    case 'add_people':
      return { type: 'add_people', people: input.people as Array<{ name: string; department: string; role: string }> };
    case 'remove_person':
      return { type: 'remove_person', name: input.name as string };
    case 'record_completion':
      return {
        type: 'record_completion',
        person_name: input.person_name as string,
        task_name: input.task_name as string,
      };
    case 'get_report':
      return {
        type: 'get_report',
        filter_field: input.filter_field as string | undefined,
        filter_value: input.filter_value as string | undefined,
      };
    case 'list_people':
      return {
        type: 'list_people',
        group_by: input.group_by as string | undefined,
        filter_field: input.filter_field as string | undefined,
        filter_value: input.filter_value as string | undefined,
      };
    case 'list_tasks':
      return { type: 'list_tasks' };
    case 'clear_db':
      return { type: 'clear_db' };
    default:
      return { type: 'unknown', reply: (input.reply as string) || 'מצטער, לא הצלחתי להבין את הבקשה.' };
  }
}
