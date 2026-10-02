export type Word = { id: string; korean: string; meaning?: string };

// Supports quoted CSV fields, escaped quotes, commas and line breaks.
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function parseWords(text: string, filename: string): Word[] {
  text = text.replace(/^\uFEFF/, '');
  let entries: unknown;
  if (/\.csv$/i.test(filename)) {
    const [headers, ...rows] = csvRows(text);
    if (!headers?.includes('korean'))
      throw new Error(
        'CSV needs a korean column. Optional columns: id, meaning.',
      );
    entries = rows.map((row) =>
      Object.fromEntries(
        headers.map((key, i) => [key.trim(), row[i]?.trim() || '']),
      ),
    );
  } else if (/\.json$/i.test(filename)) entries = JSON.parse(text);
  else if (/\.jsonl$/i.test(filename))
    entries = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  else throw new Error('Choose a JSON, JSONL or CSV file.');
  if (!Array.isArray(entries) || !entries.length || entries.length > 10000)
    throw new Error('Provide a list with 1–10,000 words.');
  return entries.map((item, i) => {
    const value =
      typeof item === 'string'
        ? { korean: item }
        : item && { ...item, korean: item.korean ?? item.text };
    if (
      !value ||
      typeof value.korean !== 'string' ||
      !value.korean.trim() ||
      value.korean.length > 200
    )
      throw new Error(`Word ${i + 1} needs korean text (1–200 characters).`);
    return {
      id: String(value.id || i + 1),
      korean: value.korean.trim(),
      meaning: typeof value.meaning === 'string' ? value.meaning : undefined,
    };
  });
}
