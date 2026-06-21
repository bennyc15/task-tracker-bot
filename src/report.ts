import { getAllPeople, getPeopleBy, getAllTasks, isCompleted } from './db';
import { resolvePerson } from './resolver';

export function generateReport(filterField?: string, filterValue?: string): string {
  let people = getAllPeople();
  if (filterField && filterValue) {
    if (filterField === 'full_name') {
      const resolved = resolvePerson(filterValue, people);
      people = resolved.status === 'found' ? [resolved.item] : [];
    } else {
      people = getPeopleBy(filterField, filterValue);
    }
  }
  const tasks = getAllTasks();

  if (people.length === 0) {
    return 'אין אנשים ברשימה עדיין.';
  }

  if (tasks.length === 0) {
    return 'אין משימות ברשימה עדיין.';
  }

  const title = filterField && filterValue
    ? `📊 *דוח השלמת משימות — ${filterValue}*`
    : '📊 *דוח השלמת משימות*';
  const lines: string[] = [title, ''];

  for (const person of people) {
    const relevantTasks = tasks.filter(t => {
      if (!t.required_role) return true;
      const roles = t.required_role.split(',').map(r => r.trim());
      return roles.includes(person.role);
    });
    const completed: string[] = [];
    const missing: string[] = [];

    for (const task of relevantTasks) {
      if (isCompleted(person.id, task.id)) {
        completed.push(task.name);
      } else {
        missing.push(task.name);
      }
    }

    if (relevantTasks.length === 0) continue;
    const allDone = missing.length === 0;
    const statusIcon = allDone ? '✅' : '⚠️';
    const meta = [person.department, person.crew, person.role].filter(Boolean).join(' · ');
    lines.push(`${statusIcon} *${person.full_name}*${meta ? ` (${meta})` : ''}`);

    if (completed.length > 0) {
      lines.push(`  ✔ ${completed.join(', ')}`);
    }

    if (missing.length > 0) {
      lines.push(`  ✘ חסר: ${missing.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
