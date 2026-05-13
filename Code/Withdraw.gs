// ==========================================
// ACTION: PROCESS WITHDRAWAL
// ==========================================
function processWithdrawal(deviceData) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { success: false, msg: "Email not detected" };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date();

    const usersData = ss.getSheetByName("Users").getDataRange().getValues();
    const emailCol = usersData[0].indexOf("Work_Email");
    const idCol = usersData[0].indexOf("Allstars_ID");

    let allstarsId = null;
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][emailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
        allstarsId = usersData[i][idCol]; break;
      }
    }
    if (!allstarsId) return { success: false, msg: `User not found: ${email}` };

    const enrollSheet = ss.getSheetByName("Enrollments");
    const enrollData = enrollSheet.getDataRange().getValues();
    const enHeaders = enrollData[0];

    const enrIdCol = enHeaders.indexOf("Allstars_ID");
    const planCol = enHeaders.indexOf("Current_Plan");
    const invCol = enHeaders.indexOf("Investment_Plan");
    const lastWdCol = enHeaders.indexOf("Last_Withdrawal_Date");
    const wdCountCol = enHeaders.indexOf("Withdrawal_Count");

    let enrollRowIdx = -1;
    for (let i = 1; i < enrollData.length; i++) {
      if (enrollData[i][enrIdCol] == allstarsId) { enrollRowIdx = i + 1; break; }
    }
    if (enrollRowIdx === -1) return { success: false, msg: "You are not currently enrolled." };

    let currentWdCount = parseInt(enrollSheet.getRange(enrollRowIdx, wdCountCol + 1).getValue()) || 0;

    // Clear active plans
    enrollSheet.getRange(enrollRowIdx, planCol + 1).setValue("");
    if (invCol !== -1) enrollSheet.getRange(enrollRowIdx, invCol + 1).setValue("");

    // Update withdrawal dates and count
    enrollSheet.getRange(enrollRowIdx, lastWdCol + 1).setValue(today);
    enrollSheet.getRange(enrollRowIdx, wdCountCol + 1).setValue(currentWdCount + 1);

    // Add to Audit Log
    const auditSheet = ss.getSheetByName("Audit_Log");
    auditSheet.appendRow([today, allstarsId, email, "Withdraw", "", "", "", deviceData || "Unknown Device"]);

    return { success: true };
  } catch (error) { return { success: false, msg: error.toString() }; }
}