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


// ===========================================
// HELPER FUNCTION - Company Match Tiers
// ===========================================
function calculateMatchTier(years) {
  if (years < 5) return "3%";
  if (years < 7) return "5%";
  if (years < 10) return "7%";
  return "10%";
}

function getUserProfile() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    const userSheet = ss.getSheetByName(SHEET_USERS);
    const enrollSheet = ss.getSheetByName(SHEET_ENROLLMENTS); 
    
    const data = userSheet.getDataRange().getValues(); 
    const headers = data[0].map(h => String(h).trim());
    
    const emailCol = headers.indexOf('Work_Email');
    const nameCol = headers.indexOf('Name_English');
    const titleCol = headers.indexOf('Business_Title');
    const hireDateCol = headers.indexOf('Hire_Date');
    const idCol = headers.indexOf('Allstars_ID');
    const probationCol = headers.indexOf('Probation_End');

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][emailCol]).toLowerCase().trim() === userEmail) {
        
        let rawHireDate = data[i][hireDateCol]; 
        let rawProbationDate = data[i][probationCol];
        let allstarsId = data[i][idCol]; 
        
        // --- 1. FETCH ENROLLMENT DATA ---
        let enrollmentData = {
          isEnrolled: false,
          withdrawalCount: 0,
          enrolledDate: null,
          lastWithdrawalDate: null, // NEW
          currentPlan: null
        };
        
        if (enrollSheet) {
          const enrollData = enrollSheet.getDataRange().getValues();
          const enHeaders = enrollData[0].map(h => String(h).trim());
          const enIdCol = enHeaders.indexOf('Allstars_ID');
          
          for (let j = 1; j < enrollData.length; j++) {
            if (String(enrollData[j][enIdCol]).trim() === String(allstarsId).trim()) {
              enrollmentData.withdrawalCount = enrollData[j][enHeaders.indexOf('Withdrawal_Count')] || 0;
              enrollmentData.enrolledDate = enrollData[j][enHeaders.indexOf('Current_Enrolled_Date')] || null;
              enrollmentData.lastWithdrawalDate = enrollData[j][enHeaders.indexOf('Last_Withdrawal_Date')] || null; 
              enrollmentData.currentPlan = enrollData[j][enHeaders.indexOf('Current_Plan')] || null;
              enrollmentData.isEnrolled = enrollmentData.currentPlan ? true : false; 
              break; 
            }
          }
        }

        // --- 2. CALCULATE ELIGIBILITY ---
        const today = new Date();
        
        let isOnProbation = false;
        if (rawProbationDate instanceof Date && rawProbationDate > today) {
          isOnProbation = true;
        }

        // NEW: Cooldown Logic (12 Months)
        let isCoolingDown = false;
        let cooldownEndDate = null;
        
        if (enrollmentData.withdrawalCount === 1 && enrollmentData.lastWithdrawalDate instanceof Date) {
          let unlockDate = new Date(enrollmentData.lastWithdrawalDate);
          unlockDate.setFullYear(unlockDate.getFullYear() + 1); // Add exactly 1 year
          
          if (today < unlockDate) {
            isCoolingDown = true;
            cooldownEndDate = String(unlockDate); // Pass the date they can rejoin
          }
        }

        let startDateForMath = rawHireDate;
        if (enrollmentData.withdrawalCount === 1 && enrollmentData.enrolledDate instanceof Date) {
          startDateForMath = enrollmentData.enrolledDate;
        }

        let tenureYears = 0;
        if (startDateForMath instanceof Date) {
          tenureYears = (today - startDateForMath) / (1000 * 60 * 60 * 24 * 365.25);
        }
        let matchPercent = calculateMatchTier(tenureYears);

        // CLEAN RETURN: We strip out the raw Date objects from enrollmentData 
        // so Google Apps Script doesn't crash during the transfer.
        return {
          success: true,
          name: data[i][nameCol],
          title: data[i][titleCol],
          hireDate: String(rawHireDate),
          allstarsId: allstarsId,
          
          // Only sending safe text/numbers to the frontend
          enrollment: {
            isEnrolled: enrollmentData.isEnrolled,
            withdrawalCount: enrollmentData.withdrawalCount,
            currentPlan: enrollmentData.currentPlan
          },
          
          isOnProbation: isOnProbation,
          isCoolingDown: isCoolingDown,
          cooldownEndDate: cooldownEndDate, // This is already safely converted to a String!
          matchPercent: matchPercent,
          tenureYears: tenureYears.toFixed(2)
        };
      }
    }
    return { success: false, msg: "User not found" };
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
    .addMetaTag('viewport', 'width=device-width, initial-scale=1'); 
}

// ==========================================
// 4. LOGIN ERROR REPORTING
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
