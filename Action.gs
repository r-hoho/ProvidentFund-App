// ==========================================
// ACTION: PROCESS ENROLLMENT
// ==========================================
function processEnrollment(selectedPlan, deviceData) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) {
      return { success: false, msg: "ไม่พบอีเมลผู้ใช้งาน (Email not detected)" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date();

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
        enrollRowIdx = i + 1; 
        break;
      }
    }

    if (enrollRowIdx !== -1) {
      const currentFirstDate = enrollSheet.getRange(enrollRowIdx, firstDateCol + 1).getValue();
      
      if (!currentFirstDate || currentFirstDate === "") {
        enrollSheet.getRange(enrollRowIdx, firstDateCol + 1).setValue(today);
      }
      
      enrollSheet.getRange(enrollRowIdx, currentDateCol + 1).setValue(today);
      enrollSheet.getRange(enrollRowIdx, planCol + 1).setValue(selectedPlan);

    } else {
      const newRow = new Array(enrollHeaders.length).fill("");
      newRow[enrIdCol] = allstarsId;
      newRow[firstDateCol] = today;
      newRow[currentDateCol] = today;
      newRow[planCol] = selectedPlan;
      newRow[wdCountCol] = 0;
      enrollSheet.appendRow(newRow);
    }

    const auditSheet = ss.getSheetByName("Audit_Log");
    const formattedPlan = (parseFloat(selectedPlan) * 100).toFixed(0) + "%";
    
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