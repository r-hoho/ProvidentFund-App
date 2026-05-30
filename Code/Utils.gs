// ==========================================
// LOGIN ERROR REPORTING
// ==========================================
function reportIssueToAdmin() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const adminEmail = "navananyeamsiri@airasia.com"; 
    
    const subject = `Provident Fund App: User Not Found - ${userEmail}`;
    const body = `Hello Admin,\n\nThe email '${userEmail}' is trying to login to the Provident Fund App but was not found in the database. Please check.\n\nThank you.`;
    
    MailApp.sendEmail({
      to: adminEmail,
      cc: userEmail,
      subject: subject,
      body: body
    });
    
    return { success: true };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}

// ==========================================
// Calculate Employer Match
// ==========================================

function calculateMatchTier(years) {
  if (years < 5) return "3%";
  if (years < 7) return "5%";
  if (years < 10) return "7%";
  return "10%";
}

// ==========================================
// TRANSACTION HELPERS
// ==========================================

/**
 * Generates a unique transaction ID.
 * Format: <prefix>-<YYYYMMDD>-<4-char-random>
 * e.g., PC-20260518-a1b2
 */
function generateTransactionId(prefix) {
  const date = new Date();
  const dateStr = Utilities.formatDate(date, "GMT", "yyyyMMdd");
  const randomStr = Math.random().toString(36).substring(2, 6);
  return `${prefix}-${dateStr}-${randomStr}`;
}

/**
 * Best-effort: re-finds the audit row by Transaction_ID + Event_Type, merges
 * extraFields into its Event_Data JSON, and writes it back. Used to stamp
 * post-commit outcomes (emailSent, emailError, letterFileId, ...) onto a row
 * the handler already appended. NEVER throws — a failed patch must not affect
 * the user's action, which has already succeeded.
 */
function patchAuditEventData(transactionId, eventType, extraFields) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const auditSheet = ss.getSheetByName("Audit_Log");
    const data = auditSheet.getDataRange().getValues();
    const headers = data[0];
    const txIdCol = headers.indexOf("Transaction_ID");
    const evtCol = headers.indexOf("Event_Type");
    const dataCol = headers.indexOf("Event_Data");
    if (txIdCol === -1 || evtCol === -1 || dataCol === -1) return;

    // Scan bottom-up: the row we just appended is near the end.
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][txIdCol] === transactionId && data[i][evtCol] === eventType) {
        let parsed = {};
        try { parsed = JSON.parse(data[i][dataCol] || "{}"); } catch (e) { parsed = {}; }
        for (const k in extraFields) parsed[k] = extraFields[k];
        auditSheet.getRange(i + 1, dataCol + 1).setValue(JSON.stringify(parsed));
        return;
      }
    }
  } catch (e) {
    // best-effort only — swallow
  }
}

/**
 * Returns the payroll cut-off effective date for a submission, as a display
 * string like "30 Jun 2026". Rule: submitted on/before the 15th → end of this
 * month; on/after the 16th → end of next month. Computed in Asia/Bangkok time
 * so it is correct regardless of the script's default timezone.
 * Mirrors the frontend getEffectiveDateInfo() in JS_Utils.html.
 */
function getEffectiveDate(submittedAt) {
  const tz = "Asia/Bangkok";
  const dateStr = Utilities.formatDate(new Date(submittedAt), tz, "yyyy-MM-dd");
  const parts = dateStr.split("-").map(Number);
  let year = parts[0];
  let month = parts[1]; // 1-indexed
  const day = parts[2];

  if (day > 15) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }

  // Last day of the (1-indexed) effective month: day 0 of the following month — pure arithmetic, no tz.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // Build + format in the SAME tz so the day can't shift across a boundary.
  const mm = String(month).padStart(2, "0");
  const dd = String(lastDay).padStart(2, "0");
  const effDate = Utilities.parseDate(`${year}-${mm}-${dd}`, tz, "yyyy-MM-dd");
  return Utilities.formatDate(effDate, tz, "dd MMM yyyy");
}

/**
 * Gets the editable-until deadline for a given submission date.
 * Rule: Next upcoming 15th of the month at 23:59:59 Asia/Bangkok time.
 * Constructs the deadline explicitly in Bangkok time so it is correct
 * regardless of the GAS project's default script timezone.
 */
function getEditableUntil(submittedAt) {
  const tz = "Asia/Bangkok";
  const dateStr = Utilities.formatDate(new Date(submittedAt), tz, "yyyy-MM-dd");
  const parts = dateStr.split("-").map(Number);
  let year = parts[0];
  let month = parts[1];
  const day = parts[2];

  if (day > 15) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }

  const deadlineStr = year + "-" + String(month).padStart(2, "0") + "-15 23:59:59";
  return Utilities.parseDate(deadlineStr, tz, "yyyy-MM-dd HH:mm:ss");
}

/**
 * Checks if a transaction submitted at a given date is still editable.
 */
function isWithinEditableWindow(submittedAt) {
  const now = new Date();
  const deadline = getEditableUntil(submittedAt);
  return now < deadline;
}

// ==========================================
// ENROLLMENT ROW LOOKUP
// ==========================================
/**
 * Finds the 1-indexed row number in the Enrollments sheet for a given Allstars_ID.
 * Returns -1 if not found.
 * @param {Array<Array>} enrollData The full Enrollments sheet values (from getDataRange().getValues()).
 * @param {string|number} allstarsId The user's Allstars_ID to match.
 */
function findEnrollmentRowIdx(enrollData, allstarsId) {
  const enrIdCol = enrollData[0].indexOf("Allstars_ID");
  for (let i = 1; i < enrollData.length; i++) {
    if (enrollData[i][enrIdCol] == allstarsId) {
      return i + 1;
    }
  }
  return -1;
}

// ==========================================
// DYNAMIC SHEET ROW APPENDER
// ==========================================
/**
 * Appends a row to a sheet by mapping data object keys to sheet headers.
 * This avoids column order dependency.
 * @param {Sheet} sheet The Google Sheet object.
 * @param {Object} rowData An object where keys are header names and values are the cell values.
 */
function appendRowToSheet(sheet, rowData) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newRow = new Array(headers.length).fill(""); // Create an empty array of the correct length

  // Map the data from the object to the correct column index
  for (const header in rowData) {
    const index = headers.indexOf(header);
    if (index !== -1) {
      newRow[index] = rowData[header];
    }
  }

  sheet.appendRow(newRow);
}