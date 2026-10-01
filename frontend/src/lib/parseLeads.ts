import Papa from 'papaparse';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export interface ParsedLeads {
  emails: string[];
  duplicates: number;
  rows: number;
}

/**
 * Extracts email addresses from a CSV or plain-text file.
 * - CSV: uses the "email" column if there is one, otherwise scans every cell.
 * - TXT: any addresses found anywhere (one per line, comma separated, etc.).
 * Addresses are lower-cased and de-duplicated.
 */
export async function parseLeadsFile(file: File): Promise<ParsedLeads> {
  const text = await file.text();
  const found: string[] = [];
  let rows = 0;

  if (file.name.toLowerCase().endsWith('.csv')) {
    const res = Papa.parse<string[]>(text, { skipEmptyLines: true });
    const data = res.data;
    rows = data.length;
    const header = (data[0] ?? []).map((h) => String(h).trim().toLowerCase());
    const col = header.findIndex((h) => h === 'email' || h === 'e-mail' || h === 'email address');
    const body = col >= 0 ? data.slice(1) : data;
    for (const row of body) {
      const cells = col >= 0 ? [row[col]] : row;
      for (const cell of cells) found.push(...(String(cell ?? '').match(EMAIL_RE) ?? []));
    }
  } else {
    rows = text.split(/\r?\n/).filter((l) => l.trim()).length;
    found.push(...(text.match(EMAIL_RE) ?? []));
  }

  const unique = [...new Set(found.map((e) => e.trim().toLowerCase()))];
  return { emails: unique, duplicates: found.length - unique.length, rows };
}
