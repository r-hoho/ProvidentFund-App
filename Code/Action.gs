// ==========================================
// ACTION: PROCESS ENROLLMENT (WIZARD VERSION)
// ==========================================
function processEnrollment(payload, deviceData) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { success: false, msg: "ไม่พบอีเมลผู้ใช้งาน (Email not detected)" };

    const { contributionPlan, investmentPlan, beneficiariesJSON } = payload;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date();

    // 1. Find User ID
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

    if (!allstarsId) return { success: false, msg: `User not found: ${email}` };

    // 2. Update 'Enrollments' Sheet
    const enrollSheet = ss.getSheetByName("Enrollments");
    const enrollData = enrollSheet.getDataRange().getValues();
    const enHeaders = enrollData[0];

    const enrIdCol = enHeaders.indexOf("Allstars_ID");
    const firstDateCol = enHeaders.indexOf("First_Enrolled_Date");
    const currentDateCol = enHeaders.indexOf("Current_Enrolled_Date");
    const planCol = enHeaders.indexOf("Current_Plan");
    const invCol = enHeaders.indexOf("Investment_Plan"); // NEW
    const wdCountCol = enHeaders.indexOf("Withdrawal_Count");

    if (invCol === -1) return { success: false, msg: "Admin Error: Missing 'Investment_Plan' column in Enrollments sheet." };

    let enrollRowIdx = -1;
    for (let i = 1; i < enrollData.length; i++) {
      if (enrollData[i][enrIdCol] == allstarsId) {
        enrollRowIdx = i + 1; 
        break;
      }
    }

    if (enrollRowIdx !== -1) {
      const currentFirstDate = enrollSheet.getRange(enrollRowIdx, firstDateCol + 1).getValue();
      if (!currentFirstDate || currentFirstDate === "") enrollSheet.getRange(enrollRowIdx, firstDateCol + 1).setValue(today);
      
      enrollSheet.getRange(enrollRowIdx, currentDateCol + 1).setValue(today);
      enrollSheet.getRange(enrollRowIdx, planCol + 1).setValue(contributionPlan);
      enrollSheet.getRange(enrollRowIdx, invCol + 1).setValue(investmentPlan);
    } else {
      const newRow = new Array(enHeaders.length).fill("");
      newRow[enrIdCol] = allstarsId;
      newRow[firstDateCol] = today;
      newRow[currentDateCol] = today;
      newRow[planCol] = contributionPlan;
      newRow[invCol] = investmentPlan;
      newRow[wdCountCol] = 0;
      enrollSheet.appendRow(newRow);
    }

    // 3. Append to 'Beneficiaries' Ledger
    const benSheet = ss.getSheetByName("Beneficiaries");
    if (!benSheet) return { success: false, msg: "Admin Error: Missing 'Beneficiaries' sheet." };
    
    // Schema: Timestamp | Allstars_ID | Work_Email | Beneficiary_Data
    benSheet.appendRow([today, allstarsId, email, beneficiariesJSON]);

    // 4. Append to 'Audit_Log'
    const auditSheet = ss.getSheetByName("Audit_Log");
    const formattedPlan = (parseFloat(contributionPlan) * 100).toFixed(0) + "%";
    
    auditSheet.appendRow([
      today, allstarsId, email, "Enroll", formattedPlan, investmentPlan, beneficiariesJSON, deviceData || "Unknown Device"
    ]);

    return { success: true };

  } catch (error) {
    return { success: false, msg: error.toString() };
  }
}

// ==========================================
// CHECK UI STATUS & CHANGE PLAN
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
        
        const mostRecentAction = new Date(Math.max(lastChangeDate.getTime(), enrollDate.getTime()));
        
        if (mostRecentAction.getTime() > 0) {
          const timeDifference = today.getTime() - mostRecentAction.getTime();
          const daysSinceAction = timeDifference / (1000 * 3600 * 24);

          if (daysSinceAction < 365) {
            let nextEligibleDate = new Date(mostRecentAction);
            nextEligibleDate.setFullYear(nextEligibleDate.getFullYear() + 1);
            return { locked: true, nextDate: Utilities.formatDate(nextEligibleDate, Session.getScriptTimeZone(), "dd-MMM-yyyy") };
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

    if (!allstarsId) return { success: false, msg: `User not found: ${email}` };

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

    if (mostRecentAction.getTime() > 0) {
      const timeDifference = today.getTime() - mostRecentAction.getTime();
      const daysSinceAction = timeDifference / (1000 * 3600 * 24);

      if (daysSinceAction < 365) {
        let nextEligibleDate = new Date(mostRecentAction);
        nextEligibleDate.setFullYear(nextEligibleDate.getFullYear() + 1);
        return { success: false, msg: `ไม่สามารถเปลี่ยนอัตราได้ (Cannot change plan). คุณสามารถเปลี่ยนได้อีกครั้งในวันที่ / You can change your plan again on: ${nextEligibleDate.toLocaleDateString('en-GB')}` };
      }
    }

    enrollSheet.getRange(enrollRowIdx, planCol + 1).setValue(newPlan);
    enrollSheet.getRange(enrollRowIdx, lastChangeCol + 1).setValue(today);

    const auditSheet = ss.getSheetByName("Audit_Log");
    const formattedPlan = (parseFloat(newPlan) * 100).toFixed(0) + "%";
    
    auditSheet.appendRow([today, allstarsId, email, "Change Plan", formattedPlan, "", "", deviceData || "Unknown Device"]);

    return { success: true };

  } catch (error) {
    return { success: false, msg: error.toString() };
  }
}

// ==========================================
// ACTION: UPDATE BENEFICIARIES
// ==========================================
function processUpdateBeneficiaries(beneficiariesJSON, deviceData) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { success: false, msg: "ไม่พบอีเมลผู้ใช้งาน (Email not detected)" };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date();

    // 1. Find User ID
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

    if (!allstarsId) return { success: false, msg: `User not found: ${email}` };

    // 2. Append to 'Beneficiaries' Ledger Sheet
    const benSheet = ss.getSheetByName("Beneficiaries");
    if (!benSheet) return { success: false, msg: "Admin Error: Missing 'Beneficiaries' sheet." };
    
    // Schema: Timestamp | Allstars_ID | Work_Email | Beneficiary_Data
    benSheet.appendRow([today, allstarsId, email, beneficiariesJSON]);

    // 3. Append to 'Audit_Log'
    const auditSheet = ss.getSheetByName("Audit_Log");
    // Action is "Update Beneficiaries", current plan & investment are blanked out here as they didn't change
    auditSheet.appendRow([
      today, allstarsId, email, "Update Beneficiaries", "", "", beneficiariesJSON, deviceData || "Unknown Device"
    ]);

    return { success: true };

  } catch (error) {
    return { success: false, msg: error.toString() };
  }
}