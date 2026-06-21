import Fuse from 'fuse.js';
import { Person, Task, ResolveResult } from './types';

export function searchPeopleByName(query: string, people: Person[]): Person[] {
  const lower = query.toLowerCase();

  // Word-prefix match: any word in the name starts with the query
  const prefixMatch = people.filter(p =>
    p.full_name.split(/\s+/).some(word => word.toLowerCase().startsWith(lower))
  );
  if (prefixMatch.length > 0) return prefixMatch;

  // Substring match: query appears anywhere in the full name
  const substring = people.filter(p => p.full_name.toLowerCase().includes(lower));
  if (substring.length > 0) return substring;

  // Fuzzy match on each word of the name separately — catches Hebrew nickname variants
  // (e.g. "בני" → "בינימין"). Strict per-word threshold to avoid false positives.
  const wordFuse = new Fuse(
    people.flatMap(p => p.full_name.split(/\s+/).map(word => ({ word, person: p }))),
    { keys: ['word'], threshold: 0.3, includeScore: true }
  );
  const wordMatches = wordFuse.search(query)
    .filter(r => (r.score ?? 1) < 0.3)
    .map(r => r.item.person);
  const unique = [...new Map(wordMatches.map(p => [p.id, p])).values()];
  return unique;
}

function splitName(fullName: string): string[] {
  return fullName.trim().split(/\s+/);
}

export function resolvePerson(input: string, people: Person[]): ResolveResult<Person> {
  if (people.length === 0) return { status: 'not_found' };

  const trimmed = input.trim();

  // Exact full name match
  const exact = people.find(p => p.full_name === trimmed);
  if (exact) return { status: 'found', item: exact };

  // First or last name exact match
  const partialMatches = people.filter(p => {
    const parts = splitName(p.full_name);
    return parts[0] === trimmed || parts[parts.length - 1] === trimmed;
  });

  if (partialMatches.length === 1) return { status: 'found', item: partialMatches[0] };
  if (partialMatches.length > 1) {
    return { status: 'ambiguous', candidates: partialMatches.map(p => p.full_name) };
  }

  // Fuzzy match on full name
  const fuse = new Fuse(people, {
    keys: ['full_name'],
    threshold: 0.4,
    includeScore: true,
  });

  const results = fuse.search(trimmed);
  if (results.length === 0) return { status: 'not_found' };

  const top = results[0];
  const second = results[1];

  // Accept if top score is clearly better than second
  const clearWinner = !second || (top.score ?? 1) < 0.2 && (second.score ?? 1) > (top.score ?? 1) * 2;
  if (clearWinner) return { status: 'found', item: top.item };

  return {
    status: 'ambiguous',
    candidates: results.slice(0, 3).map(r => r.item.full_name),
  };
}

export function resolveTask(input: string, tasks: Task[]): ResolveResult<Task> {
  if (tasks.length === 0) return { status: 'not_found' };

  const trimmed = input.trim();

  // Exact match
  const exact = tasks.find(t => t.name === trimmed);
  if (exact) return { status: 'found', item: exact };

  // Fuzzy match
  const fuse = new Fuse(tasks, {
    keys: ['name'],
    threshold: 0.4,
    includeScore: true,
  });

  const results = fuse.search(trimmed);
  if (results.length === 0) return { status: 'not_found' };

  const top = results[0];
  const second = results[1];

  const clearWinner = !second || (top.score ?? 1) < 0.2 && (second.score ?? 1) > (top.score ?? 1) * 2;
  if (clearWinner) return { status: 'found', item: top.item };

  return {
    status: 'ambiguous',
    candidates: results.slice(0, 3).map(r => r.item.name),
  };
}
