import { getAllPeople, getPeopleBy, getAllTasks, isCompleted } from './db';
import { resolvePerson } from './resolver';
import { Person } from './types';

function reportSection(people: Person[], tasks: ReturnType<typeof getAllTasks>, title: string): string {
  if (people.length === 0) return `${title}\n\nלא נמצאו אנשים.`;

  const lines: string[] = [title, ''];

  for (const person of people) {
    const relevantTasks = tasks.filter(t => {
      if (!t.required_role) return true;
      const roles = t.required_role.split(',').map(r => r.trim());
      return roles.includes(person.role);
    });
    if (relevantTasks.length === 0) continue;

    const completed: string[] = [];
    const missing: string[] = [];
    for (const task of relevantTasks) {
      if (isCompleted(person.id, task.id)) completed.push(task.name);
      else missing.push(task.name);
    }

    const statusIcon = missing.length === 0 ? '✅' : '⚠️';
    const meta = [person.department, person.crew, person.role].filter(Boolean).join(' · ');
    lines.push(`${statusIcon} *${person.full_name}*${meta ? ` (${meta})` : ''}`);
    if (completed.length > 0) lines.push(`  ✔ ${completed.join(', ')}`);
    if (missing.length > 0) lines.push(`  ✘ חסר: ${missing.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function resolvePeople(filterField: string, filterValue: string): Person[] {
  const all = getAllPeople();
  if (filterField === 'full_name') {
    const resolved = resolvePerson(filterValue, all);
    return resolved.status === 'found' ? [resolved.item] : [];
  }
  return getPeopleBy(filterField, filterValue);
}

export function generateReport(groups?: Array<{ filter_field: string; filter_value: string }>): string {
  const tasks = getAllTasks();
  if (tasks.length === 0) return 'אין משימות ברשימה עדיין.';

  if (!groups || groups.length === 0) {
    const people = getAllPeople();
    if (people.length === 0) return 'אין אנשים ברשימה עדיין.';
    return reportSection(people, tasks, '📊 *דוח השלמת משימות*');
  }

  const sections = groups.map(g => {
    const people = resolvePeople(g.filter_field, g.filter_value);
    return reportSection(people, tasks, `📊 *דוח השלמת משימות — ${g.filter_value}*`);
  });

  return sections.join('\n\n---\n\n');
}
