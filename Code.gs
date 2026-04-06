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
            currentPlan: enrollmentData.currentPlan,
            enrolledDate: enrollmentData.enrolledDate ? String(enrollmentData.enrolledDate) : null // <-- NEW: Safely passing the date!
          },
          
          isOnProbation: isOnProbation,
          isCoolingDown: isCoolingDown,
          cooldownEndDate: cooldownEndDate, // This is already safely converted to a String!
          matchPercent: matchPercent,
          tenureYears: tenureYears.toFixed(2)
        };
      }
    }
    return { success: false, msg: `ไม่พบข้อมูลผู้ใช้งาน (User not found): ${userEmail}` };
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

// ==========================================
// 5.ACTION: PROCESS ENROLLMENT
// ==========================================
function processEnrollment(selectedPlan, deviceData) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) {
      return { success: false, msg: "ไม่พบอีเมลผู้ใช้งาน (Email not detected)" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date();

    // ----------------------------------------------------
    // STEP 1: Find Allstars_ID from 'Users' Sheet
    // ----------------------------------------------------
    const usersSheet = ss.getSheetByName("Users");
    const usersData = usersSheet.getDataRange().getValues();
    const usersHeaders = usersData[0];
    
    const emailCol = usersHeaders.indexOf("Work_Email");
    const idCol = usersHeaders.indexOf("Allstars_ID");

    let allstarsId = null;
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][emailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
        allstarsId = usersData[i][idCol];
        break;
      }
    }

    if (!allstarsId) {
      return { success: false, msg: `ไม่พบข้อมูลผู้ใช้งาน (User not found): ${email}` };
    }

    // ----------------------------------------------------
    // STEP 2: Update 'Enrollments' Sheet
    // ----------------------------------------------------
    const enrollSheet = ss.getSheetByName("Enrollments");
    const enrollData = enrollSheet.getDataRange().getValues();
    const enrollHeaders = enrollData[0];

    const enrIdCol = enrollHeaders.indexOf("Allstars_ID");
    const firstDateCol = enrollHeaders.indexOf("First_Enrolled_Date");
    const currentDateCol = enrollHeaders.indexOf("Current_Enrolled_Date");
    const planCol = enrollHeaders.indexOf("Current_Plan");
    const wdCountCol = enrollHeaders.indexOf("Withdrawal_Count");

    let enrollRowIdx = -1;
    for (let i = 1; i < enrollData.length; i++) {
      if (enrollData[i][enrIdCol] == allstarsId) {
        enrollRowIdx = i + 1; // +1 for 1-based indexing in Apps Script ranges
        break;
      }
    }

    if (enrollRowIdx !== -1) {
      // User exists in Enrollments, update their record
      const currentFirstDate = enrollSheet.getRange(enrollRowIdx, firstDateCol + 1).getValue();
      
      // Rule: Set First_Enrolled_Date only if it's currently empty
      if (!currentFirstDate || currentFirstDate === "") {
        enrollSheet.getRange(enrollRowIdx, firstDateCol + 1).setValue(today);
      }
      
      // Rule: Always set Current_Enrolled_Date on enrollment
      enrollSheet.getRange(enrollRowIdx, currentDateCol + 1).setValue(today);
      
      // Update their plan
      enrollSheet.getRange(enrollRowIdx, planCol + 1).setValue(selectedPlan);

    } else {
      // Failsafe: If they somehow exist in Users but not in Enrollments, create their row
      const newRow = new Array(enrollHeaders.length).fill("");
      newRow[enrIdCol] = allstarsId;
      newRow[firstDateCol] = today;
      newRow[currentDateCol] = today;
      newRow[planCol] = selectedPlan;
      newRow[wdCountCol] = 0;
      enrollSheet.appendRow(newRow);
    }

    // ----------------------------------------------------
    // STEP 3: Append to 'Audit_Log' Sheet
    // ----------------------------------------------------
    const auditSheet = ss.getSheetByName("Audit_Log");
    const formattedPlan = (parseFloat(selectedPlan) * 100).toFixed(0) + "%";
    
    // Schema: Timestamp | Allstars_ID | Email | Action | Selected_Plan | Metadata
    auditSheet.appendRow([
      today, 
      allstarsId, 
      email,           
      "Enroll", 
      formattedPlan,   
      deviceData || "Unknown Device"
    ]);

    return { success: true };

  } catch (error) {
    return { success: false, msg: error.toString() };
  }
}

// ==========================================
// CHECK UI STATUS: PLAN CHANGE COOLDOWN
// ==========================================
function checkPlanChangeEligibility() {
  try {
    const email = Session.getActiveUser().getEmail();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date();

    const usersData = ss.getSheetByName("Users").getDataRange().getValues();
    const emailCol = usersData[0].indexOf("Work_Email");
    const idCol = usersData[0].indexOf("Allstars_ID");

    let allstarsId = null;
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][emailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
        allstarsId = usersData[i][idCol];
        break;
      }
    }

    if (!allstarsId) return { locked: false };

    const enrollData = ss.getSheetByName("Enrollments").getDataRange().getValues();
    const enrIdCol = enrollData[0].indexOf("Allstars_ID");
    const lastChangeCol = enrollData[0].indexOf("Last_Plan_Change_Date");
    const enrollDateCol = enrollData[0].indexOf("Current_Enrolled_Date");

    for (let i = 1; i < enrollData.length; i++) {
      if (enrollData[i][enrIdCol] == allstarsId) {
        const lastChangeDate = enrollData[i][lastChangeCol] instanceof Date ? enrollData[i][lastChangeCol] : new Date(0);
        const enrollDate = enrollData[i][enrollDateCol] instanceof Date ? enrollData[i][enrollDateCol] : new Date(0);
        
        // Find the most recent action date
        const mostRecentAction = new Date(Math.max(lastChangeDate.getTime(), enrollDate.getTime()));
        
        if (mostRecentAction.getTime() > 0) {
          const timeDifference = today.getTime() - mostRecentAction.getTime();
          const daysSinceAction = timeDifference / (1000 * 3600 * 24);

          if (daysSinceAction < 365) {
            let nextEligibleDate = new Date(mostRecentAction);
            nextEligibleDate.setFullYear(nextEligibleDate.getFullYear() + 1);
            return { 
              locked: true, 
              nextDate: nextEligibleDate.toLocaleDateString('en-GB') 
            };
          }
        }
        break;
      }
    }
    return { locked: false };
  } catch (e) {
    return { locked: false };
  }
}


// ==========================================
// ACTION: CHANGE PLAN (With Dual 12-Month Rule)
// ==========================================
function processChangePlan(newPlan, deviceData) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { success: false, msg: "ไม่พบอีเมลผู้ใช้งาน (Email not detected)" };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date();

    const usersData = ss.getSheetByName("Users").getDataRange().getValues();
    const emailCol = usersData[0].indexOf("Work_Email");
    const idCol = usersData[0].indexOf("Allstars_ID");

    let allstarsId = null;
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][emailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
        allstarsId = usersData[i][idCol];
        break;
      }
    }

    if (!allstarsId) return { success: false, msg: `ไม่พบข้อมูลผู้ใช้งาน (User not found): ${email}` };

    const enrollSheet = ss.getSheetByName("Enrollments");
    const enrollData = enrollSheet.getDataRange().getValues();
    const enrIdCol = enrollData[0].indexOf("Allstars_ID");
    const planCol = enrollData[0].indexOf("Current_Plan");
    const lastChangeCol = enrollData[0].indexOf("Last_Plan_Change_Date");
    const enrollDateCol = enrollData[0].indexOf("Current_Enrolled_Date");

    let enrollRowIdx = -1;
    let mostRecentAction = new Date(0);

    for (let i = 1; i < enrollData.length; i++) {
      if (enrollData[i][enrIdCol] == allstarsId) {
        enrollRowIdx = i + 1;
        const lastChangeDate = enrollData[i][lastChangeCol] instanceof Date ? enrollData[i][lastChangeCol] : new Date(0);
        const enrollDate = enrollData[i][enrollDateCol] instanceof Date ? enrollData[i][enrollDateCol] : new Date(0);
        mostRecentAction = new Date(Math.max(lastChangeDate.getTime(), enrollDate.getTime()));
        break;
      }
    }

    if (enrollRowIdx === -1) return { success: false, msg: "You are not currently enrolled in the fund." };

    // --- DUAL COOLDOWN CHECK ---
    if (mostRecentAction.getTime() > 0) {
      const timeDifference = today.getTime() - mostRecentAction.getTime();
      const daysSinceAction = timeDifference / (1000 * 3600 * 24);

      if (daysSinceAction < 365) {
        let nextEligibleDate = new Date(mostRecentAction);
        nextEligibleDate.setFullYear(nextEligibleDate.getFullYear() + 1);
        let dateString = nextEligibleDate.toLocaleDateString('en-GB'); 

        return { 
          success: false, 
          msg: `ไม่สามารถเปลี่ยนอัตราได้ (Cannot change plan). คุณสามารถเปลี่ยนได้อีกครั้งในวันที่ / You can change your plan again on: ${dateString}` 
        };
      }
    }

    enrollSheet.getRange(enrollRowIdx, planCol + 1).setValue(newPlan);
    enrollSheet.getRange(enrollRowIdx, lastChangeCol + 1).setValue(today);

    const auditSheet = ss.getSheetByName("Audit_Log");
    const formattedPlan = (parseFloat(newPlan) * 100).toFixed(0) + "%";
    
    auditSheet.appendRow([
      today, allstarsId, email, "Change Plan", formattedPlan, deviceData || "Unknown Device"
    ]);

    return { success: true };

  } catch (error) {
    return { success: false, msg: error.toString() };
  }
}