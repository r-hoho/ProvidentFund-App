//PAC PVD TOUCH

// ==========================================
// 1. GLOBAL CONSTANTS
// ==========================================
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_USERS = 'Users';
const SHEET_ENROLLMENTS = 'Enrollments';
const SHEET_AUDIT = 'Audit_Log';
const SHEET_REPORTING = 'Monthly_Reporting';

// ==========================================
// 2. CORE IDENTITY & PROFILE LOOKUP
// ==========================================

/**
 * Retrieves the current user's profile based strictly on their active Google session.
 * This ensures the frontend cannot spoof identities.
*/

function getUserProfile() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const userSheet = ss.getSheetByName(SHEET_USERS);
    const data = userSheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    
    const emailCol = headers.indexOf('Work_Email');
    const nameCol = headers.indexOf('Name_English');
    const titleCol = headers.indexOf('Business_Title');
    const hireDateCol = headers.indexOf('Hire_Date');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][emailCol]).toLowerCase().trim() === userEmail) {

        let rawDate = data[i][hireDateCol];

        return {
          success: true,
          name: data[i][nameCol],
          title: data[i][titleCol],
          hireDate: String(rawDate) // Simple conversion to prevent crash
        };
      }
    }
    return { success: false, msg: "ไม่พบข้อมูลผู้ใช้งาน / Email not found: " + userEmail };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}


// ===========================================
// 3. WEB APP SETUP
// ===========================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Provident Fund App')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1'); // Crucial for mobile-first
}

// ==========================================
// 4. ERROR REPORTING
// ==========================================
function reportIssueToAdmin() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    
    // Admin email
    const adminEmail = "navananyeamsiri@airasia.com"; 
    
    // Injecting the user's email directly into the subject
    const subject = `Provident Fund App: User Not Found - ${userEmail}`;
    
    const body = `Hello Admin,\n\nThe email '${userEmail}' is trying to login to the Provident Fund App but was not found in the database. Please check.\n\nThank you.`;
    
    // Using the advanced Options Object to include CC
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
