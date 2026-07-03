/**
 * Fetches all records from the Audit_Log sheet.
 * This is the sole source of truth for the event-sourced Dashboard.
 * 
 * @returns {Array<Object>} Array of objects representing the audit log rows.
 */
function getAuditData() {
  console.log('Attempting to open Spreadsheet ID:', SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  console.log('Attempting to access Sheet Name:', SHEET_AUDIT);
  const sheet = ss.getSheetByName(SHEET_AUDIT);
  
  if (!sheet) {
    console.error('Audit_Log sheet not found.');
    throw new Error('Audit_Log sheet not found.');
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  
  console.log('Total rows found in sheet (including headers):', values.length);
  
  if (values.length <= 1) {
    console.log('Sheet is effectively empty (0 or 1 row). Returning empty array.');
    return []; // No data, just headers
  }

  const headers = values[0];
  console.log('Headers found:', headers);
  const records = [];

  // Map rows to objects based on headers
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const record = {};
    for (let j = 0; j < headers.length; j++) {
      let val = row[j];
      // Google Apps Script cannot serialize Date objects back to the client natively
      if (val instanceof Date) {
        val = val.toISOString();
      }
      record[headers[j]] = val;
    }
    records.push(record);
  }

  console.log('Successfully mapped records:', records.length);
  return records;
}
