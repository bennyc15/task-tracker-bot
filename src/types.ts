export interface Person {
  id: number;
  full_name: string;
  department: string;
  crew: string;
  role: string;
}

export interface Task {
  id: number;
  name: string;
  required_role: string;
}

export interface CompletionRow {
  person_name: string;
  task_name: string;
  reported_at: string;
}

export interface IncomingMessage {
  from: string;    // user ID — used for admin check
  chatId: string;  // chat ID — used to send the reply (group or DM)
  text: string;
  messageId: string;
}

export type Intent =
  | { type: 'add_tasks'; tasks: Array<{ name: string; required_roles: string[] }> }
  | { type: 'remove_task'; task_name: string }
  | { type: 'add_people'; people: Array<{ name: string; department: string; crew: string; role: string }> }
  | { type: 'update_people'; people: Array<{ name: string; department?: string; crew?: string; role?: string }> }
  | { type: 'remove_person'; name: string }
  | { type: 'record_completion'; person_name: string; task_name: string }
  | { type: 'remove_completion'; person_name: string; task_name: string }
  | { type: 'bulk_completion'; filters: Array<{ field: string; value: string }>; task_name: string; undo?: boolean }
  | { type: 'get_report'; groups?: Array<{ filter_field: string; filter_value: string }> }
  | { type: 'list_people'; filters?: Array<{ field: string; value: string }>; group_by?: string }
  | { type: 'task_roster'; task_name: string; show: 'completed' | 'missing' | 'all' }
  | { type: 'list_tasks' }
  | { type: 'clear_db' }
  | { type: 'add_instruction'; instruction: string }
  | { type: 'list_instructions' }
  | { type: 'remove_instruction'; id: number }
  | { type: 'unknown'; reply: string }
  | { type: 'text_response'; text: string };

export type ResolveResult<T> =
  | { status: 'found'; item: T }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'not_found' };
