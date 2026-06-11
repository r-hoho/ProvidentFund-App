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

    // 1. Find User ID (+ profile fields needed for the confirmation letter)
    const usersData = ss.getSheetByName("Users").getDataRange().getValues();
    const emailCol = usersData[0].indexOf("Work_Email");
    const idCol = usersData[0].indexOf("Allstars_ID");
    const nameColU = usersData[0].indexOf("Name_English");
    const titleColU = usersData[0].indexOf("Business_Title");
    const hireColU = usersData[0].indexOf("Hire_Date");

    let allstarsId = null;
    let userName = "", userTitle = "", userHireDate = "";
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][emailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
        allstarsId = usersData[i][idCol];
        userName = usersData[i][nameColU];
        userTitle = usersData[i][titleColU];
        userHireDate = usersData[i][hireColU];
        break;
      }
    }

    if (!allstarsId) return { success: false, msg: `User not found: ${email}` };

    // Transaction id is owned by the handler so it threads into audit + letter + email + patch.
    const transactionId = generateTransactionId("EN");
    let wasFirstEnrollment = false;

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

    const enrollRowIdx = findEnrollmentRowIdx(enrollData, allstarsId);

    if (enrollRowIdx !== -1) {
      const enrollRow = enrollSheet.getRange(enrollRowIdx, 1, 1, enrollSheet.getLastColumn()).getValues()[0];
      const priorValues = {
        "First_Enrolled_Date": enrollRow[firstDateCol],
        "Current_Enrolled_Date": enrollRow[currentDateCol],
        "Current_Plan": enrollRow[planCol],
        "Investment_Plan": enrollRow[invCol]
      };
      
      const currentFirstDate = enrollSheet.getRange(enrollRowIdx, firstDateCol + 1).getValue();
      wasFirstEnrollment = (!currentFirstDate || currentFirstDate === "");
      if (wasFirstEnrollment) enrollSheet.getRange(enrollRowIdx, firstDateCol + 1).setValue(today);

      enrollSheet.getRange(enrollRowIdx, currentDateCol + 1).setValue(today);
      enrollSheet.getRange(enrollRowIdx, planCol + 1).setValue(contributionPlan);
      enrollSheet.getRange(enrollRowIdx, invCol + 1).setValue(investmentPlan);

      writeEnrollmentAudit(allstarsId, email, contributionPlan, investmentPlan, beneficiariesJSON, deviceData, priorValues, transactionId);
    } else {
       const priorValues = {
        "First_Enrolled_Date": "",
        "Current_Enrolled_Date": "",
        "Current_Plan": "",
        "Investment_Plan": ""
      };
      const newRow = new Array(enHeaders.length).fill("");
      newRow[enrIdCol] = allstarsId;
      newRow[firstDateCol] = today;
      newRow[currentDateCol] = today;
      newRow[planCol] = contributionPlan;
      newRow[invCol] = investmentPlan;
      newRow[wdCountCol] = 0;
      enrollSheet.appendRow(newRow);
      wasFirstEnrollment = true;
      writeEnrollmentAudit(allstarsId, email, contributionPlan, investmentPlan, beneficiariesJSON, deviceData, priorValues, transactionId);
    }

    // 3. Append to 'Beneficiaries' Ledger
    const benSheet = ss.getSheetByName("Beneficiaries");
    if (!benSheet) return { success: false, msg: "Admin Error: Missing 'Beneficiaries' sheet." };
    
    // Schema: Timestamp | Allstars_ID | Work_Email | Beneficiary_Data
    benSheet.appendRow([today, allstarsId, email, beneficiariesJSON]);

    // 4. Signed PDF letter + confirmation email — best-effort, must NEVER block
    //    the enrollment. Letter/email failures are logged to the audit row only.
    const tz = "Asia/Bangkok";
    const fmtDate = d => (d instanceof Date) ? Utilities.formatDate(d, tz, "dd MMM yyyy") : (d || "").toString();
    let tenureYears = 0;
    if (userHireDate instanceof Date) {
      tenureYears = (today.getTime() - userHireDate.getTime()) / (1000 * 3600 * 24 * 365.25);
    }

    const ctx = {
      nameEn: userName,
      allstarsId: allstarsId,
      businessTitle: userTitle,
      workEmail: email,
      hireDate: fmtDate(userHireDate),
      // Membership start: hire date on first enrollment, else this re-enrollment date.
      memberSinceDate: fmtDate(wasFirstEnrollment ? userHireDate : today),
      planPct: (parseFloat(contributionPlan) * 100).toFixed(0) + "%",
      employerMatchPct: calculateMatchTier(tenureYears),
      investmentPlan: investmentPlan,
      effectiveMonth: getEffectiveMonthLabel(today), // payroll month for the letter (matches banner/email)
      transactionId: transactionId,
      beneficiaries: []
    };
    try { ctx.beneficiaries = JSON.parse(beneficiariesJSON) || []; } catch (e) { /* keep [] */ }

    let letterFileId = null, letterError = null;
    try {
      const r = generateLetter("ENROLLMENT", ctx, payload.sigDataUrl);
      letterFileId = r.fileId;
    } catch (e) {
      letterError = e.toString();
    }

    const emailResult = sendActionConfirmation({
      userEmail: email,
      userName: userName,
      actionType: "Enroll",
      eventType: "SUBMITTED",
      details: {
        planPct: contributionPlan,
        investmentPlan: investmentPlan,
        effectiveMonth: getEffectiveMonthLabel(today),
        transactionId: transactionId
      },
      attachmentFileId: letterFileId
    });

    patchAuditEventData(transactionId, "SUBMITTED", {
      letterFileId: letterFileId,
      letterError: letterError,
      emailSent: emailResult.sent,
      emailError: emailResult.error || null,
      signedAt: payload.sigDataUrl ? today : null
    });

    // Letter failed but the action succeeded: alert admin (CC user) so a
    // document is followed up. Best-effort — never affects the result.
    if (letterError) {
      sendLetterFailureAlert({
        userEmail: email, userName: userName, actionType: "Enroll",
        transactionId: transactionId, error: letterError
      });
    }

    trackFeatureAction("enroll", "success");
    return { success: true };

  } catch (error) {
    trackFeatureAction("enroll", "fail");
    return { success: false, msg: error.toString() };
  }
}

function writeEnrollmentAudit(allstarsId, email, contributionPlan, investmentPlan, beneficiariesJSON, deviceData, priorValues, transactionId){
    const today = new Date();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const auditSheet = ss.getSheetByName("Audit_Log");
    const formattedPlan = (parseFloat(contributionPlan) * 100).toFixed(0) + "%";
    const eventData = {
      "priorValues": priorValues,
      "newValues": {
        "Current_Enrolled_Date": today,
        "Current_Plan": contributionPlan,
        "Investment_Plan": investmentPlan,
        "Beneficiaries": JSON.parse(beneficiariesJSON)
      }
    };

    const auditRowData = {
      "Timestamp": today,
      "Allstars_ID": allstarsId,
      "Email": email,
      "Action": "Enroll",
      "Selected_Plan": formattedPlan,
      "Investment_Plan": investmentPlan,
      "Beneficiary_Data": beneficiariesJSON,
      "Metadata": deviceData || "Unknown Device",
      "Transaction_ID": transactionId,
      "Event_Type": "SUBMITTED",
      "Event_Data": JSON.stringify(eventData)
    };
    
    appendRowToSheet(auditSheet, auditRowData);
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
    const nameCol = usersData[0].indexOf("Name_English");

    let allstarsId = null;
    let userName = "";
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][emailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
        allstarsId = usersData[i][idCol];
        userName = usersData[i][nameCol];
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

    const enrollRowIdx = findEnrollmentRowIdx(enrollData, allstarsId);
    if (enrollRowIdx === -1) return { success: false, msg: "You are not currently enrolled in the fund." };

    const rowForLockMath = enrollData[enrollRowIdx - 1];
    const lastChangeDateForMath = rowForLockMath[lastChangeCol] instanceof Date ? rowForLockMath[lastChangeCol] : new Date(0);
    const enrollDateForMath = rowForLockMath[enrollDateCol] instanceof Date ? rowForLockMath[enrollDateCol] : new Date(0);
    const mostRecentAction = new Date(Math.max(lastChangeDateForMath.getTime(), enrollDateForMath.getTime()));

    const enrollRow = enrollSheet.getRange(enrollRowIdx, 1, 1, enrollSheet.getLastColumn()).getValues()[0];
    const priorPlan = enrollRow[planCol];
    const priorLastChangeDate = enrollRow[lastChangeCol];

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
    const transactionId = generateTransactionId("PC");
    const eventData = {
      "priorValues": {
        "Current_Plan": priorPlan,
        "Last_Plan_Change_Date": priorLastChangeDate
      },
      "newValues": {
        "Current_Plan": newPlan,
        "Last_Plan_Change_Date": today
      }
    };
    
    const auditRowData = {
      "Timestamp": today,
      "Allstars_ID": allstarsId,
      "Email": email,
      "Action": "Change Plan",
      "Selected_Plan": formattedPlan,
      "Metadata": deviceData || "Unknown Device",
      "Transaction_ID": transactionId,
      "Event_Type": "SUBMITTED",
      "Event_Data": JSON.stringify(eventData)
    };
    appendRowToSheet(auditSheet, auditRowData);

    // Confirmation email — best-effort, must never block the action.
    const emailResult = sendActionConfirmation({
      userEmail: email,
      userName: userName,
      actionType: "Change Plan",
      eventType: "SUBMITTED",
      details: {
        oldPct: priorPlan,
        newPct: newPlan,
        effectiveMonth: getEffectiveMonthLabel(today),
        transactionId: transactionId
      }
    });
    patchAuditEventData(transactionId, "SUBMITTED", {
      emailSent: emailResult.sent,
      emailError: emailResult.error || null
    });

    trackFeatureAction("change_plan", "success");
    return { success: true };

  } catch (error) {
    trackFeatureAction("change_plan", "fail");
    return { success: false, msg: error.toString() };
  }
}

// ==========================================
// ACTION: UPDATE BENEFICIARIES
// ==========================================
function processUpdateBeneficiaries(payload, deviceData) {
  try {
    // Accepts either the new payload object { beneficiariesJSON, sigDataUrl } or,
    // for backward tolerance, a bare beneficiariesJSON string.
    const beneficiariesJSON = (typeof payload === "string") ? payload : payload.beneficiariesJSON;
    const sigDataUrl = (typeof payload === "string") ? null : payload.sigDataUrl;

    const email = Session.getActiveUser().getEmail();
    if (!email) return { success: false, msg: "ไม่พบอีเมลผู้ใช้งาน (Email not detected)" };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const today = new Date();

    // 1. Find User ID (+ profile fields needed for the confirmation letter)
    const usersData = ss.getSheetByName("Users").getDataRange().getValues();
    const emailCol = usersData[0].indexOf("Work_Email");
    const idCol = usersData[0].indexOf("Allstars_ID");
    const nameColU = usersData[0].indexOf("Name_English");
    const titleColU = usersData[0].indexOf("Business_Title");
    const hireColU = usersData[0].indexOf("Hire_Date");

    let allstarsId = null;
    let userName = "", userTitle = "", userHireDate = "";
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][emailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
        allstarsId = usersData[i][idCol];
        userName = usersData[i][nameColU];
        userTitle = usersData[i][titleColU];
        userHireDate = usersData[i][hireColU];
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
    // Action is "Update Beneficiaries"; current plan & investment are blanked out here as they didn't change.
    // No priorValues: the Beneficiaries sheet is an append-only ledger, so the prior state is already
    // preserved as the previous row by Timestamp. Event_Data carries only the submitted (new) list.
    const auditSheet = ss.getSheetByName("Audit_Log");
    const transactionId = generateTransactionId("BN");
    const eventData = {
      "newValues": {
        "Beneficiaries": JSON.parse(beneficiariesJSON)
      }
    };
    const auditRowData = {
      "Timestamp": today,
      "Allstars_ID": allstarsId,
      "Email": email,
      "Action": "Update Beneficiaries",
      "Selected_Plan": "",
      "Investment_Plan": "",
      "Beneficiary_Data": beneficiariesJSON,
      "Metadata": deviceData || "Unknown Device",
      "Transaction_ID": transactionId,
      "Event_Type": "SUBMITTED",
      "Event_Data": JSON.stringify(eventData)
    };
    appendRowToSheet(auditSheet, auditRowData);

    // 4. Signed PDF letter + confirmation email — best-effort, must NEVER block
    //    the update. Beneficiary is effective immediately (no cancel state).
    //    Reuses the enrollment template until a trimmed beneficiary template
    //    is supplied (PF_BENEFICIARY_TEMPLATE_ID); enrollment-only placeholders
    //    (rate/match/investment/member-since) render blank for now.
    const tz = "Asia/Bangkok";
    const fmtDate = d => (d instanceof Date) ? Utilities.formatDate(d, tz, "dd MMM yyyy") : (d || "").toString();

    const ctx = {
      nameEn: userName,
      allstarsId: allstarsId,
      businessTitle: userTitle,
      workEmail: email,
      hireDate: fmtDate(userHireDate),
      memberSinceDate: "",
      planPct: "",
      employerMatchPct: "",
      investmentPlan: "",
      effectiveDate: fmtDate(today), // immediate — no payroll cut-off
      transactionId: transactionId,
      beneficiaries: []
    };
    try { ctx.beneficiaries = JSON.parse(beneficiariesJSON) || []; } catch (e) { /* keep [] */ }

    let letterFileId = null, letterError = null;
    try {
      const r = generateLetter("BENEFICIARY", ctx, sigDataUrl);
      letterFileId = r.fileId;
    } catch (e) {
      letterError = e.toString();
    }

    const emailResult = sendActionConfirmation({
      userEmail: email,
      userName: userName,
      actionType: "Update Beneficiaries",
      eventType: "SUBMITTED",
      details: {
        beneficiaries: ctx.beneficiaries,
        transactionId: transactionId
      },
      attachmentFileId: letterFileId
    });

    patchAuditEventData(transactionId, "SUBMITTED", {
      letterFileId: letterFileId,
      letterError: letterError,
      emailSent: emailResult.sent,
      emailError: emailResult.error || null,
      signedAt: sigDataUrl ? today : null
    });

    // Letter failed but the action succeeded: alert admin (CC user) so a
    // document is followed up. Best-effort — never affects the result.
    if (letterError) {
      sendLetterFailureAlert({
        userEmail: email, userName: userName, actionType: "Update Beneficiaries",
        transactionId: transactionId, error: letterError
      });
    }

    trackFeatureAction("beneficiary", "success");
    return { success: true };

  } catch (error) {
    trackFeatureAction("beneficiary", "fail");
    return { success: false, msg: error.toString() };
  }
}

// ==========================================
// ACTION: CANCEL PENDING TRANSACTION
// ==========================================
/**
 * Cancels a pending transaction within the cancellable window.
 * Reverts the affected Enrollments fields using priorValues captured at SUBMITTED
 * time and appends a CANCELLED row to Audit_Log with the same Transaction_ID.
 * No penalty side-effects: plan-change lock, withdrawal count, and re-enrollment
 * cooldown are all rolled back.
 */
function cancelTransaction(transactionId, deviceData) {
  try {
    const email = Session.getActiveUser().getEmail();
    if (!email) return { success: false, msg: "ไม่พบอีเมลผู้ใช้งาน (Email not detected)" };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const auditSheet = ss.getSheetByName(SHEET_AUDIT);
    const auditData = auditSheet.getDataRange().getValues();
    const headers = auditData[0];

    const tsCol = headers.indexOf("Timestamp");
    const idCol = headers.indexOf("Allstars_ID");
    const emailColIdx = headers.indexOf("Email");
    const actionCol = headers.indexOf("Action");
    const txIdCol = headers.indexOf("Transaction_ID");
    const eventTypeCol = headers.indexOf("Event_Type");
    const eventDataCol = headers.indexOf("Event_Data");

    if (txIdCol === -1 || eventTypeCol === -1 || eventDataCol === -1) {
      return { success: false, msg: "Admin Error: Audit_Log is missing Phase 1 columns." };
    }

    let submittedRow = null;
    let alreadyCancelled = false;
    for (let i = 1; i < auditData.length; i++) {
      if (auditData[i][txIdCol] !== transactionId) continue;
      const evt = auditData[i][eventTypeCol];
      if (evt === "SUBMITTED" && !submittedRow) submittedRow = auditData[i];
      if (evt === "CANCELLED") alreadyCancelled = true;
    }

    if (!submittedRow) return { success: false, msg: "ไม่พบรายการ / Transaction not found." };
    if (alreadyCancelled) return { success: false, msg: "รายการถูกยกเลิกแล้ว / Transaction already cancelled." };

    if (submittedRow[emailColIdx].toString().trim().toLowerCase() !== email.toLowerCase()) {
      return { success: false, msg: "ไม่มีสิทธิ์ยกเลิกรายการนี้ / Not authorized to cancel this transaction." };
    }

    const submittedAt = submittedRow[tsCol];
    if (!isWithinEditableWindow(submittedAt)) {
      return { success: false, msg: "เลยกำหนดเวลายกเลิก / The cancellation window has closed." };
    }

    const action = submittedRow[actionCol];
    const allstarsId = submittedRow[idCol];
    let priorValues = {};
    try {
      const parsed = JSON.parse(submittedRow[eventDataCol]);
      priorValues = parsed.priorValues || {};
    } catch (e) {
      return { success: false, msg: "Admin Error: Cannot parse Event_Data for this transaction." };
    }

    const enrollSheet = ss.getSheetByName(SHEET_ENROLLMENTS);
    const enrollData = enrollSheet.getDataRange().getValues();
    const enHeaders = enrollData[0];
    const rowIdx = findEnrollmentRowIdx(enrollData, allstarsId);
    if (rowIdx === -1) return { success: false, msg: "Admin Error: Enrollment row not found for user." };

    const restoredValues = {};

    const writeField = function(fieldName, value) {
      const col = enHeaders.indexOf(fieldName);
      if (col === -1) return;
      enrollSheet.getRange(rowIdx, col + 1).setValue(value);
      restoredValues[fieldName] = value;
    };

    const prior = function(fieldName, fallback) {
      return (priorValues[fieldName] !== undefined && priorValues[fieldName] !== null)
        ? priorValues[fieldName]
        : fallback;
    };

    if (action === "Enroll") {
      writeField("First_Enrolled_Date", prior("First_Enrolled_Date", ""));
      writeField("Current_Enrolled_Date", prior("Current_Enrolled_Date", ""));
      writeField("Current_Plan", prior("Current_Plan", ""));
      writeField("Investment_Plan", prior("Investment_Plan", ""));
    } else if (action === "Change Plan") {
      writeField("Current_Plan", prior("Current_Plan", ""));
      writeField("Last_Plan_Change_Date", prior("Last_Plan_Change_Date", ""));
    } else if (action === "Withdraw") {
      writeField("Withdrawal_Count", prior("Withdrawal_Count", 0));
      writeField("Last_Withdrawal_Date", "");
      writeField("Current_Plan", prior("Current_Plan", ""));
      writeField("Investment_Plan", prior("Investment_Plan", ""));
    } else {
      return { success: false, msg: "ประเภทรายการไม่รองรับการยกเลิก / Action type does not support cancellation." };
    }

    const today = new Date();
    const cancelEventData = {
      cancelledAt: today,
      originalTransactionId: transactionId,
      restoredValues: restoredValues
    };

    appendRowToSheet(auditSheet, {
      "Timestamp": today,
      "Allstars_ID": allstarsId,
      "Email": email,
      "Action": action,
      "Metadata": deviceData || "Cancelled via dashboard",
      "Transaction_ID": transactionId,
      "Event_Type": "CANCELLED",
      "Event_Data": JSON.stringify(cancelEventData)
    });

    // Confirmation email — best-effort, must never block the cancellation.
    // Reuses the original Transaction_ID for continuity with the SUBMITTED email.
    const usersData = ss.getSheetByName("Users").getDataRange().getValues();
    const uEmailCol = usersData[0].indexOf("Work_Email");
    const uNameCol = usersData[0].indexOf("Name_English");
    let userName = "";
    for (let i = 1; i < usersData.length; i++) {
      if (usersData[i][uEmailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
        userName = usersData[i][uNameCol];
        break;
      }
    }
    const emailResult = sendActionConfirmation({
      userEmail: email,
      userName: userName,
      actionType: action,
      eventType: "CANCELLED",
      details: { transactionId: transactionId }
    });
    patchAuditEventData(transactionId, "CANCELLED", {
      emailSent: emailResult.sent,
      emailError: emailResult.error || null
    });

    trackFeatureAction("cancel", "success");
    return { success: true, msg: "ยกเลิกรายการสำเร็จ / Transaction cancelled." };
  } catch (error) {
    trackFeatureAction("cancel", "fail");
    return { success: false, msg: error.toString() };
  }
}