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
 * Gets the editable-until deadline for a given submission date.
 * Rule: Next upcoming 15th of the month at 23:59:59 Asia/Bangkok time.
 */
function getEditableUntil(submittedAt) {
  const bangkokTz = "Asia/Bangkok";

  // Start with the submission date in Bangkok time
  let deadline = new Date(submittedAt);

  // Set the time to the deadline time
  deadline.setHours(23, 59, 59, 999);

  const dayOfMonth = deadline.getDate();

  // If submitted after the 15th, deadline is next month's 15th.
  if (dayOfMonth > 15) {
    deadline.setMonth(deadline.getMonth() + 1);
  }

  // Set the day to the 15th
  deadline.setDate(15);

  return deadline;
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