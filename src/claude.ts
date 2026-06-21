import Anthropic from '@anthropic-ai/sdk';
import { Intent } from './types';
import { getAllInstructions } from './db';

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
              department: { type: 'string', description: 'מחלקה (אופציונלי)' },
              crew: { type: 'string', description: 'צוות (תת-יחידה בתוך המחלקה, למשל "צוות 1א") (אופציונלי)' },
              role: { type: 'string', description: 'תפקיד (אופציונלי)' },
            },
            required: ['name'],
          },
        },
      },
      required: ['people'],
    },
  },
  {
    name: 'update_people',
    description: 'עדכן שדות של אנשים קיימים — מחלקה, צוות, תפקיד. השתמש תמיד בכלי זה גם אם יש אדם אחד בלבד',
    input_schema: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          description: 'רשימת אנשים לעדכון',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'שם האדם לעדכון' },
              department: { type: 'string', description: 'מחלקה חדשה (אופציונלי)' },
              crew: { type: 'string', description: 'צוות חדש (אופציונלי)' },
              role: { type: 'string', description: 'תפקיד חדש (אופציונלי)' },
            },
            required: ['name'],
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
    name: 'remove_completion',
    description: 'בטל רישום השלמת משימה עבור אדם — השתמש כאשר רוצים להוריד/לבטל/למחוק השלמה שנרשמה בטעות',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'שם האדם' },
        task_name: { type: 'string', description: 'שם המשימה לביטול' },
      },
      required: ['person_name', 'task_name'],
    },
  },
  {
    name: 'bulk_completion',
    description: 'רשום השלמת משימה לקבוצת אנשים (צוות, מחלקה, תפקיד) בבת אחת — השתמש כאשר אומרים "צוות X עשה Y" או "כולם ביצעו Y". undo=true לביטול קבוצתי.',
    input_schema: {
      type: 'object',
      properties: {
        task_name: { type: 'string', description: 'שם המשימה' },
        filters: {
          type: 'array',
          description: 'סינון הקבוצה (crew/department/role)',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: ['department', 'crew', 'role'] },
              value: { type: 'string' },
            },
            required: ['field', 'value'],
          },
        },
        undo: { type: 'boolean', description: 'true כדי לבטל את ההשלמות במקום לרשום' },
      },
      required: ['task_name', 'filters'],
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
          enum: ['department', 'crew', 'role', 'full_name'],
          description: 'שדה לסינון — השתמש כאשר המשתמש מבקש דוח למחלקה, צוות, תפקיד או אדם ספציפי',
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
    description: 'הצג את רשימת האנשים. השתמש ב-group_by לקיבוץ, ו-filters לסינון לפי ערכים ספציפיים — ניתן לשלב מספר פילטרים (למשל: צוות ד + תפקיד תותחן)',
    input_schema: {
      type: 'object',
      properties: {
        group_by: {
          type: 'string',
          enum: ['department', 'crew', 'role'],
          description: 'קיבוץ כל האנשים לפי שדה זה — השתמש כאשר המשתמש אומר "לפי מחלקה" / "לפי צוות" / "לפי תפקיד" ללא ערך ספציפי',
        },
        filters: {
          type: 'array',
          description: 'רשימת תנאי סינון — כל תנאי הוא שדה+ערך. ניתן לשלב מספר תנאים יחד',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                enum: ['department', 'crew', 'role', 'full_name'],
                description: 'שדה לסינון',
              },
              value: {
                type: 'string',
                description: 'הערך לחיפוש',
              },
            },
            required: ['field', 'value'],
          },
        },
      },
    },
  },
  {
    name: 'task_roster',
    description: 'הצג מי ביצע / לא ביצע משימה ספציפית. השתמש כאשר שואלים "מי ביצע X", "מי לא ביצע X", "כמה אנשים עשו X"',
    input_schema: {
      type: 'object',
      properties: {
        task_name: { type: 'string', description: 'שם המשימה' },
        show: {
          type: 'string',
          enum: ['completed', 'missing', 'all'],
          description: '"completed" — מי ביצע, "missing" — מי לא ביצע, "all" — כולם עם סטטוס',
        },
      },
      required: ['task_name', 'show'],
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
    name: 'add_instruction',
    description: 'שמור הנחיה קבועה שתשפיע על ההתנהגות העתידית של הבוט — למשל "כאשר X אמור Y", "תמיד פרש Z כ-W"',
    input_schema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'ההנחיה לשמירה בעברית' },
      },
      required: ['instruction'],
    },
  },
  {
    name: 'list_instructions',
    description: 'הצג את רשימת ההנחיות השמורות',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'remove_instruction',
    description: 'הסר הנחיה שמורה לפי מספר ID',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'מספר ה-ID של ההנחיה להסרה' },
      },
      required: ['id'],
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
    name: 'remove_completion',
    description: 'בטל רישום השלמת משימה עבור אדם — השתמש כאשר רוצים להוריד/לבטל/למחוק השלמה שנרשמה בטעות',
    input_schema: {
      type: 'object',
      properties: {
        person_name: { type: 'string', description: 'שם האדם' },
        task_name: { type: 'string', description: 'שם המשימה לביטול' },
      },
      required: ['person_name', 'task_name'],
    },
  },
  {
    name: 'bulk_completion',
    description: 'רשום השלמת משימה לקבוצת אנשים (צוות, מחלקה, תפקיד) בבת אחת — השתמש כאשר אומרים "צוות X עשה Y" או "כולם ביצעו Y". undo=true לביטול קבוצתי.',
    input_schema: {
      type: 'object',
      properties: {
        task_name: { type: 'string', description: 'שם המשימה' },
        filters: {
          type: 'array',
          description: 'סינון הקבוצה (crew/department/role)',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: ['department', 'crew', 'role'] },
              value: { type: 'string' },
            },
            required: ['field', 'value'],
          },
        },
        undo: { type: 'boolean', description: 'true כדי לבטל את ההשלמות במקום לרשום' },
      },
      required: ['task_name', 'filters'],
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
          enum: ['department', 'crew', 'role', 'full_name'],
          description: 'שדה לסינון — השתמש כאשר המשתמש מבקש דוח למחלקה, צוות, תפקיד או אדם ספציפי',
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
    description: 'הצג את רשימת האנשים. השתמש ב-group_by לקיבוץ, ו-filters לסינון לפי ערכים ספציפיים — ניתן לשלב מספר פילטרים (למשל: צוות ד + תפקיד תותחן)',
    input_schema: {
      type: 'object',
      properties: {
        group_by: {
          type: 'string',
          enum: ['department', 'crew', 'role'],
          description: 'קיבוץ כל האנשים לפי שדה זה — השתמש כאשר המשתמש אומר "לפי מחלקה" / "לפי צוות" / "לפי תפקיד" ללא ערך ספציפי',
        },
        filters: {
          type: 'array',
          description: 'רשימת תנאי סינון — כל תנאי הוא שדה+ערך. ניתן לשלב מספר תנאים יחד',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                enum: ['department', 'crew', 'role', 'full_name'],
                description: 'שדה לסינון',
              },
              value: {
                type: 'string',
                description: 'הערך לחיפוש',
              },
            },
            required: ['field', 'value'],
          },
        },
      },
    },
  },
  {
    name: 'task_roster',
    description: 'הצג מי ביצע / לא ביצע משימה ספציפית. השתמש כאשר שואלים "מי ביצע X", "מי לא ביצע X", "כמה אנשים עשו X"',
    input_schema: {
      type: 'object',
      properties: {
        task_name: { type: 'string', description: 'שם המשימה' },
        show: {
          type: 'string',
          enum: ['completed', 'missing', 'all'],
          description: '"completed" — מי ביצע, "missing" — מי לא ביצע, "all" — כולם עם סטטוס',
        },
      },
      required: ['task_name', 'show'],
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

const ADMIN_SYSTEM = `אתה בוט לניהול משימות שמשתתף בקבוצת טלגרם.
כל תשובותיך חייבות להיות בעברית בלבד.
לפעולות ניהול (הוספה, עדכון, הסרה, דוח, רשימה) — השתמש תמיד בכלי המתאים, גם אם השם לא מדויק — המערכת מטפלת בחיפוש מטושטש ובהבהרות אוטומטית.
לשאלות כלליות, ברכות ושיחת חולין — ענה בטבעיות כחבר קבוצה.
אם ההודעה היא תשובה לשאלת הבהרה קודמת — המשך את הפעולה המקורית עם הפרטים החדשים.
כשמעבירים שמות לכלים — העבר בדיוק כפי שנכתב, אל תרחיב כינויים.`;

const REPORTER_SYSTEM = `אתה בוט לניהול משימות שמשתתף בקבוצת טלגרם.
כל תשובותיך חייבות להיות בעברית בלבד.
לדיווח על השלמת משימה או בקשת דוח — השתמש תמיד בכלי המתאים, גם אם השם לא מדויק — המערכת מטפלת בחיפוש מטושטש ובהבהרות אוטומטית.
לשאלות כלליות, ברכות ושיחת חולין — ענה בטבעיות כחבר קבוצה.
אם ההודעה היא תשובה לשאלת הבהרה קודמת — המשך את הפעולה המקורית עם הפרטים החדשים.
כשמעבירים שמות לכלים — העבר בדיוק כפי שנכתב, אל תרחיב כינויים.`;

export type HistoryEntry = { role: 'user' | 'assistant'; content: string };

export async function parseIntent(
  message: string,
  isAdmin: boolean,
  history: HistoryEntry[] = [],
): Promise<Intent> {
  const tools = isAdmin ? ADMIN_TOOLS : REPORTER_TOOLS;
  const instructions = getAllInstructions();
  const instructionBlock = instructions.length > 0
    ? `\n\nהנחיות מותאמות אישית (מהמנהל):\n${instructions.map(i => `- ${i.instruction}`).join('\n')}`
    : '';
  const system = (isAdmin ? ADMIN_SYSTEM : REPORTER_SYSTEM) + instructionBlock;

  const messages: Anthropic.MessageParam[] = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system,
    tools,
    tool_choice: { type: 'auto' },
    messages,
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

  if (!toolUse) {
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const text = textBlock?.text?.trim() || 'מצטער, לא הצלחתי להבין את הבקשה.';
    return { type: 'text_response', text };
  }

  const input = toolUse.input as Record<string, unknown>;

  switch (toolUse.name) {
    case 'add_tasks':
      return { type: 'add_tasks', tasks: input.tasks as Array<{ name: string; required_roles: string[] }> };
    case 'remove_task':
      return { type: 'remove_task', task_name: input.task_name as string };
    case 'add_people':
      return { type: 'add_people', people: input.people as Array<{ name: string; department: string; crew: string; role: string }> };
    case 'update_people':
      return {
        type: 'update_people',
        people: input.people as Array<{ name: string; department?: string; crew?: string; role?: string }>,
      };
    case 'remove_person':
      return { type: 'remove_person', name: input.name as string };
    case 'record_completion':
      return {
        type: 'record_completion',
        person_name: input.person_name as string,
        task_name: input.task_name as string,
      };
    case 'remove_completion':
      return {
        type: 'remove_completion',
        person_name: input.person_name as string,
        task_name: input.task_name as string,
      };
    case 'bulk_completion':
      return {
        type: 'bulk_completion',
        task_name: input.task_name as string,
        filters: input.filters as Array<{ field: string; value: string }>,
        undo: input.undo as boolean | undefined,
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
        filters: input.filters as Array<{ field: string; value: string }> | undefined,
      };
    case 'task_roster':
      return {
        type: 'task_roster',
        task_name: input.task_name as string,
        show: input.show as 'completed' | 'missing' | 'all',
      };
    case 'list_tasks':
      return { type: 'list_tasks' };
    case 'clear_db':
      return { type: 'clear_db' };
    case 'add_instruction':
      return { type: 'add_instruction', instruction: input.instruction as string };
    case 'list_instructions':
      return { type: 'list_instructions' };
    case 'remove_instruction':
      return { type: 'remove_instruction', id: input.id as number };
    default:
      return { type: 'unknown', reply: (input.reply as string) || 'מצטער, לא הצלחתי להבין את הבקשה.' };
  }
}
