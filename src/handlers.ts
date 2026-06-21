import { parseIntent, HistoryEntry } from './claude';
import { generateReport } from './report';
import { generateExcel } from './export';
import { sendMessage, sendDocument } from './telegram';
import { resolvePerson, resolveTask, searchPeopleByName } from './resolver';
import {
  getAllPeople,
  getPeopleByFilters,
  getAllTasks,
  addPerson,
  updatePerson,
  removePerson,
  addTask,
  removeTask,
  recordCompletion,
  removeCompletion,
  isCompleted,
  clearDb,
  clearCompletions,
  addInstruction,
  getAllInstructions,
  removeInstruction,
} from './db';
import { IncomingMessage } from './types';

const ADMIN_CHAT_IDS = new Set(
  (process.env.ADMIN_CHAT_IDS ?? '').split(',').map(p => p.trim()).filter(Boolean)
);

function isAdmin(phone: string): boolean {
  return ADMIN_CHAT_IDS.has(phone);
}

const MAX_HISTORY = 6; // 3 exchanges
const chatHistory = new Map<string, HistoryEntry[]>();

export async function handleMessage(msg: IncomingMessage): Promise<void> {
  const admin = isAdmin(msg.from);
  let reply: string;
  const history = chatHistory.get(msg.chatId) ?? [];

  try {
    const intent = await parseIntent(msg.text, admin, history);

    switch (intent.type) {
      case 'add_tasks': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const results: string[] = [];
        for (const t of intent.tasks) {
          const rolesStr = t.required_roles.join(',');
          const added = addTask(t.name, rolesStr);
          const roleTag = t.required_roles.length > 0 ? ` (${t.required_roles.join(', ')})` : '';
          results.push(added ? `✓ ${t.name}${roleTag}` : `✗ ${t.name} (כבר קיימת)`);
        }
        reply = `תוצאות הוספת משימות:\n${results.join('\n')}`;
        break;
      }

      case 'remove_task': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const tasks = getAllTasks();
        const resolved = resolveTask(intent.task_name, tasks);
        if (resolved.status === 'not_found') {
          reply = `לא נמצאה משימה בשם "${intent.task_name}".`;
        } else if (resolved.status === 'ambiguous') {
          reply = `נמצאו מספר משימות דומות:\n${resolved.candidates.join('\n')}\nאנא ציין שם מדויק יותר.`;
        } else {
          removeTask(resolved.item.id);
          reply = `המשימה "${resolved.item.name}" הוסרה בהצלחה.`;
        }
        break;
      }

      case 'add_people': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const results: string[] = [];
        const allPeople = getAllPeople();
        for (const p of intent.people) {
          // Fuzzy-check first to prevent creating duplicates with nickname variants
          const existing = resolvePerson(p.name, allPeople);
          if (existing.status === 'found') {
            updatePerson(existing.item.id, {
              department: p.department,
              crew: p.crew,
              role: p.role,
            });
            results.push(`✓ ${existing.item.full_name} (עודכן)`);
          } else if (existing.status === 'ambiguous') {
            results.push(`✗ "${p.name}" — מספר תוצאות דומות: ${existing.candidates.join(', ')}`);
          } else {
            const added = addPerson(p.name, p.department ?? '', p.crew ?? '', p.role ?? '');
            results.push(added ? `✓ ${p.name} (נוסף)` : `✗ ${p.name} (כבר קיים בדיוק — בדוק שם)`);
          }
        }
        reply = `תוצאות הוספת אנשים:\n${results.join('\n')}`;
        break;
      }

      case 'update_people': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const allPeopleForUpdate = getAllPeople();
        const results: string[] = [];
        for (const p of intent.people) {
          const resolved = resolvePerson(p.name, allPeopleForUpdate);
          if (resolved.status === 'not_found') {
            results.push(`✗ "${p.name}" — לא נמצא`);
          } else if (resolved.status === 'ambiguous') {
            results.push(`✗ "${p.name}" — מספר תוצאות: ${resolved.candidates.join(', ')}`);
          } else {
            updatePerson(resolved.item.id, { full_name: p.full_name, department: p.department, crew: p.crew, role: p.role });
            const newName = p.full_name ?? resolved.item.full_name;
            const changes = [
              p.full_name && `שם: ${p.full_name}`,
              p.department && `מחלקה: ${p.department}`,
              p.crew && `צוות: ${p.crew}`,
              p.role && `תפקיד: ${p.role}`,
            ].filter(Boolean).join(', ');
            results.push(`✅ ${newName} — ${changes || '(אין שינויים)'}`);
          }
        }
        reply = `תוצאות עדכון:\n${results.join('\n')}`;
        break;
      }

      case 'remove_person': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const people = getAllPeople();
        const resolved = resolvePerson(intent.name, people);
        if (resolved.status === 'not_found') {
          reply = `לא נמצא אדם בשם "${intent.name}".`;
        } else if (resolved.status === 'ambiguous') {
          reply = `נמצאו מספר אנשים דומים:\n${resolved.candidates.join('\n')}\nאנא ציין שם מדויק יותר.`;
        } else {
          removePerson(resolved.item.id);
          reply = `${resolved.item.full_name} הוסר בהצלחה.`;
        }
        break;
      }

      case 'record_completion': {
        const people = getAllPeople();
        const tasks = getAllTasks();

        const personResult = resolvePerson(intent.person_name, people);
        const taskResult = resolveTask(intent.task_name, tasks);

        if (personResult.status === 'not_found') {
          reply = `לא נמצא אדם בשם "${intent.person_name}".`;
          break;
        }
        if (personResult.status === 'ambiguous') {
          reply = `נמצאו מספר אנשים דומים לשם "${intent.person_name}":\n${personResult.candidates.join('\n')}\nאנא ציין שם מלא.`;
          break;
        }
        if (taskResult.status === 'not_found') {
          reply = `לא נמצאה משימה בשם "${intent.task_name}".`;
          break;
        }
        if (taskResult.status === 'ambiguous') {
          reply = `נמצאו מספר משימות דומות:\n${taskResult.candidates.join('\n')}\nאנא ציין שם מדויק יותר.`;
          break;
        }

        const saved = recordCompletion(personResult.item.id, taskResult.item.id, msg.from);
        reply = saved
          ? `✅ ${personResult.item.full_name} השלים את המשימה "${taskResult.item.name}".`
          : `${personResult.item.full_name} כבר רשום כמי שהשלים את "${taskResult.item.name}".`;
        break;
      }

      case 'bulk_completion': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const tasks = getAllTasks();
        const taskResult = resolveTask(intent.task_name, tasks);
        if (taskResult.status === 'not_found') { reply = `לא נמצאה משימה בשם "${intent.task_name}".`; break; }
        if (taskResult.status === 'ambiguous') {
          reply = `נמצאו מספר משימות:\n${taskResult.candidates.join('\n')}\nאנא ציין שם מדויק יותר.`;
          break;
        }
        const task = taskResult.item;
        const group = intent.filters.length > 0 ? getPeopleByFilters(intent.filters) : getAllPeople();
        const relevant = group.filter(p => {
          if (!task.required_role) return true;
          const roles = task.required_role.split(',').map(r => r.trim());
          return roles.includes(p.role);
        });
        if (relevant.length === 0) { reply = 'לא נמצאו אנשים מתאימים.'; break; }
        let count = 0;
        for (const p of relevant) {
          if (intent.undo) { removeCompletion(p.id, task.id); count++; }
          else { if (recordCompletion(p.id, task.id, msg.from)) count++; }
        }
        const label = intent.filters.map(f => f.value).join(', ') || 'כולם';
        reply = intent.undo
          ? `↩️ בוטל רישום "${task.name}" עבור ${count} אנשים (${label}).`
          : `✅ נרשמה השלמת "${task.name}" עבור ${count} אנשים (${label}).`;
        break;
      }

      case 'remove_completion': {
        const people = getAllPeople();
        const tasks = getAllTasks();
        const personResult = resolvePerson(intent.person_name, people);
        const taskResult = resolveTask(intent.task_name, tasks);
        if (personResult.status === 'not_found') {
          reply = `לא נמצא אדם בשם "${intent.person_name}".`;
          break;
        }
        if (personResult.status === 'ambiguous') {
          reply = `נמצאו מספר אנשים:\n${personResult.candidates.join('\n')}\nאנא ציין שם מדויק יותר.`;
          break;
        }
        if (taskResult.status === 'not_found') {
          reply = `לא נמצאה משימה בשם "${intent.task_name}".`;
          break;
        }
        if (taskResult.status === 'ambiguous') {
          reply = `נמצאו מספר משימות:\n${taskResult.candidates.join('\n')}\nאנא ציין שם מדויק יותר.`;
          break;
        }
        const removed = removeCompletion(personResult.item.id, taskResult.item.id);
        reply = removed
          ? `✅ בוטל רישום ההשלמה של "${taskResult.item.name}" עבור ${personResult.item.full_name}.`
          : `${personResult.item.full_name} לא היה רשום כמי שהשלים את "${taskResult.item.name}".`;
        break;
      }

      case 'export_excel': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const buf = await generateExcel();
        const date = new Date().toISOString().slice(0, 10);
        await sendDocument(msg.chatId, buf, `report-${date}.xlsx`);
        reply = '📎 קובץ האקסל נשלח.';
        break;
      }

      case 'get_report': {
        reply = generateReport(intent.groups);
        break;
      }

      case 'task_roster': {
        const tasks = getAllTasks();
        const taskResult = resolveTask(intent.task_name, tasks);
        if (taskResult.status === 'not_found') {
          reply = `לא נמצאה משימה בשם "${intent.task_name}".`;
          break;
        }
        if (taskResult.status === 'ambiguous') {
          reply = `נמצאו מספר משימות דומות:\n${taskResult.candidates.join('\n')}\nאנא ציין שם מדויק יותר.`;
          break;
        }
        const task = taskResult.item;
        const allPeople = getAllPeople();
        const relevant = allPeople.filter(p => {
          if (!task.required_role) return true;
          const roles = task.required_role.split(',').map(r => r.trim());
          return roles.includes(p.role);
        });
        const completed = relevant.filter(p => isCompleted(p.id, task.id));
        const missing = relevant.filter(p => !isCompleted(p.id, task.id));

        const lines: string[] = [`📋 *${task.name}*`];
        if (intent.show === 'completed' || intent.show === 'all') {
          lines.push('', `✅ *ביצעו (${completed.length}):*`);
          if (completed.length === 0) lines.push('  אף אחד עדיין');
          else completed.forEach(p => lines.push(`  • ${p.full_name} (${[p.department, p.crew].filter(Boolean).join(' · ')})`));
        }
        if (intent.show === 'missing' || intent.show === 'all') {
          lines.push('', `⚠️ *לא ביצעו (${missing.length}):*`);
          if (missing.length === 0) lines.push('  כולם ביצעו!');
          else missing.forEach(p => lines.push(`  • ${p.full_name} (${[p.department, p.crew].filter(Boolean).join(' · ')})`));
        }
        reply = lines.join('\n');
        break;
      }

      case 'list_people': {
        const { filters, group_by } = intent;
        let people: ReturnType<typeof getAllPeople>;

        const nameFilter = filters?.find(f => f.field === 'full_name');
        const otherFilters = filters?.filter(f => f.field !== 'full_name') ?? [];

        if (nameFilter) {
          const all = otherFilters.length > 0 ? getPeopleByFilters(otherFilters) : getAllPeople();
          people = searchPeopleByName(nameFilter.value, all);
        } else if (otherFilters.length > 0) {
          people = getPeopleByFilters(otherFilters);
        } else {
          people = getAllPeople();
        }

        if (people.length === 0) {
          reply = filters && filters.length > 0
            ? `לא נמצאו אנשים התואמים את החיפוש.`
            : 'אין אנשים רשומים במערכת עדיין.';
          break;
        }

        if (group_by) {
          const groups = new Map<string, typeof people>();
          for (const p of people) {
            const key = (group_by === 'department' ? p.department : group_by === 'crew' ? p.crew : p.role) || '(ללא)';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(p);
          }
          const sections: string[] = [`👥 *אנשים לפי ${group_by} (${people.length}):*`];
          for (const [groupName, members] of groups) {
            sections.push('', `*${groupName}*`);
            for (const p of members) {
              const meta = group_by === 'department'
                ? [p.crew, p.role].filter(Boolean).join(' · ')
                : group_by === 'crew'
                  ? [p.department, p.role].filter(Boolean).join(' · ')
                  : [p.department, p.crew].filter(Boolean).join(' · ');
              sections.push(`• ${p.full_name}${meta ? ` (${meta})` : ''}`);
            }
          }
          reply = sections.join('\n');
        } else {
          const filterDesc = filters && filters.length > 0
            ? filters.map(f => `${f.field}: "${f.value}"`).join(', ')
            : null;
          const header = filterDesc
            ? `👥 *אנשים (${filterDesc}) — ${people.length}:*`
            : `👥 *רשימת אנשים (${people.length}):*`;
          const lines = people.map(p => {
            const meta = [p.department, p.crew, p.role].filter(Boolean).join(' · ');
            return `• ${p.full_name}${meta ? ` (${meta})` : ''}`;
          });
          reply = `${header}\n\n${lines.join('\n')}`;
        }
        break;
      }

      case 'list_tasks': {
        const tasks = getAllTasks();
        if (tasks.length === 0) {
          reply = 'אין משימות רשומות במערכת עדיין.';
        } else {
          const lines = tasks.map(t => {
            const roles = t.required_role ? t.required_role.split(',').map(r => r.trim()).join(', ') : '';
            return `• ${t.name}${roles ? ` _(${roles})_` : ''}`;
          });
          reply = `📋 *רשימת משימות (${tasks.length}):*\n\n${lines.join('\n')}`;
        }
        break;
      }

      case 'clear_completions': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        clearCompletions();
        reply = '↩️ כל ההשלמות הוסרו — האנשים והמשימות נשארו במערכת.';
        break;
      }

      case 'clear_db': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        clearDb();
        reply = '🗑️ מסד הנתונים נוקה בהצלחה — כל האנשים, המשימות וההשלמות נמחקו.';
        break;
      }

      case 'add_instruction': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const id = addInstruction(intent.instruction);
        reply = `✅ הנחיה #${id} נשמרה: "${intent.instruction}"`;
        break;
      }

      case 'list_instructions': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        const instructions = getAllInstructions();
        if (instructions.length === 0) {
          reply = 'אין הנחיות שמורות.';
        } else {
          const lines = instructions.map(i => `#${i.id}: ${i.instruction}`);
          reply = `📝 *הנחיות שמורות (${instructions.length}):*\n\n${lines.join('\n')}`;
        }
        break;
      }

      case 'remove_instruction': {
        if (!admin) { reply = 'אין לך הרשאה לבצע פעולה זו.'; break; }
        removeInstruction(intent.id);
        reply = `✅ הנחיה #${intent.id} הוסרה.`;
        break;
      }

      case 'unknown': {
        reply = intent.reply;
        break;
      }

      case 'text_response': {
        reply = intent.text;
        break;
      }

      default:
        reply = 'מצטער, לא הצלחתי לעבד את הבקשה.';
    }
  } catch (err) {
    console.error('handleMessage error:', err);
    reply = 'אירעה שגיאה. אנא נסה שוב מאוחר יותר.';
  }

  history.push({ role: 'user', content: msg.text });
  history.push({ role: 'assistant', content: reply });
  chatHistory.set(msg.chatId, history.slice(-MAX_HISTORY));

  await sendMessage(msg.chatId, reply);
}
