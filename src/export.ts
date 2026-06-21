import ExcelJS from 'exceljs';
import { getAllPeople, getAllTasks, isCompleted } from './db';

export async function generateExcel(): Promise<Buffer> {
  const people = getAllPeople();
  const tasks = getAllTasks();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'FlugaleBot';

  // Sheet 1: Completion matrix
  const ws = wb.addWorksheet('השלמות');
  ws.views = [{ rightToLeft: true }];

  // Header row: fixed columns + one per task
  const headerRow = ws.addRow(['שם', 'מחלקה', 'צוות', 'תפקיד', ...tasks.map(t => t.name)]);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  headerRow.alignment = { horizontal: 'center' };

  for (const person of people) {
    const cells: (string | number)[] = [person.full_name, person.department, person.crew, person.role];
    for (const task of tasks) {
      const relevant = !task.required_role ||
        task.required_role.split(',').map(r => r.trim()).includes(person.role);
      if (!relevant) {
        cells.push('-');
      } else {
        cells.push(isCompleted(person.id, task.id) ? '✓' : '✗');
      }
    }
    const row = ws.addRow(cells);
    // Color completed/missing cells
    for (let i = 5; i <= 4 + tasks.length; i++) {
      const cell = row.getCell(i);
      if (cell.value === '✓') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
      else if (cell.value === '✗') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
      cell.alignment = { horizontal: 'center' };
    }
  }

  // Auto-width for first 4 columns
  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 12;
  for (let i = 5; i <= 4 + tasks.length; i++) {
    ws.getColumn(i).width = Math.max(tasks[i - 5].name.length + 2, 10);
  }

  // Sheet 2: People list
  const ws2 = wb.addWorksheet('אנשים');
  ws2.views = [{ rightToLeft: true }];
  const h2 = ws2.addRow(['שם', 'מחלקה', 'צוות', 'תפקיד']);
  h2.font = { bold: true };
  h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  people.forEach(p => ws2.addRow([p.full_name, p.department, p.crew, p.role]));
  [1, 2, 3, 4].forEach(i => (ws2.getColumn(i).width = [22, 14, 12, 12][i - 1]));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
