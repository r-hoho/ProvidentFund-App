// ==========================================
// CORE IDENTITY & PROFILE LOOKUP
// ==========================================

function getUserProfile() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    const userSheet = ss.getSheetByName(SHEET_USERS);
    const enrollSheet = ss.getSheetByName(SHEET_ENROLLMENTS); 
    const benSheet = ss.getSheetByName(SHEET_BENEFICIARIES); // NEW
    
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
          lastWithdrawalDate: null, 
          currentPlan: null,
          investmentPlan: null,   // NEW
          beneficiariesJSON: null // NEW
        };
        
        if (enrollSheet) {
          const enrollData = enrollSheet.getDataRange().getValues();
          const enHeaders = enrollData[0].map(h => String(h).trim());
          const enIdCol = enHeaders.indexOf('Allstars_ID');
          const invCol = enHeaders.indexOf('Investment_Plan'); // NEW
          
          for (let j = 1; j < enrollData.length; j++) {
            if (String(enrollData[j][enIdCol]).trim() === String(allstarsId).trim()) {
              enrollmentData.withdrawalCount = enrollData[j][enHeaders.indexOf('Withdrawal_Count')] || 0;
              enrollmentData.enrolledDate = enrollData[j][enHeaders.indexOf('Current_Enrolled_Date')] || null;
              enrollmentData.lastWithdrawalDate = enrollData[j][enHeaders.indexOf('Last_Withdrawal_Date')] || null; 
              enrollmentData.currentPlan = enrollData[j][enHeaders.indexOf('Current_Plan')] || null;
              
              if (invCol !== -1) {
                enrollmentData.investmentPlan = enrollData[j][invCol] || null;
              }

              enrollmentData.isEnrolled = enrollmentData.currentPlan ? true : false; 
              break; 
            }
          }
        }

        // --- 1.5 FETCH BENEFICIARY DATA (Ledger Style & History) ---
        enrollmentData.beneficiaryHistory = []; // Array to store all past updates
        
        if (benSheet) {
          const benData = benSheet.getDataRange().getValues();
          const benHeaders = benData[0].map(h => String(h).trim());
          const bIdCol = benHeaders.indexOf('Allstars_ID');
          const bDataCol = benHeaders.indexOf('Beneficiary_Data');
          const bTimeCol = benHeaders.indexOf('Timestamp'); // Attempt to find Timestamp column
          
          if (bIdCol !== -1 && bDataCol !== -1) {
            // Loop BACKWARDS to read from newest to oldest
            for (let k = benData.length - 1; k >= 1; k--) {
              if (String(benData[k][bIdCol]).trim() === String(allstarsId).trim()) {
                
                // The FIRST match we hit (bottom-up) is the current active one
                if (!enrollmentData.beneficiariesJSON) {
                  enrollmentData.beneficiariesJSON = benData[k][bDataCol];
                }
                
                // Push every match into the history array
                let tStamp = bTimeCol !== -1 ? benData[k][bTimeCol] : benData[k][0]; // Fallback to col 0
                enrollmentData.beneficiaryHistory.push({
                  timestamp: tStamp instanceof Date ? String(tStamp) : String(new Date(tStamp)),
                  data: benData[k][bDataCol]
                });
              }
            }
          }
        }

        // --- 2. CALCULATE ELIGIBILITY ---
        const today = new Date();
        
        let isOnProbation = false;
        let probationEndDateStr = null; 
        
        if (rawProbationDate instanceof Date && rawProbationDate > today) {
          isOnProbation = true;
          probationEndDateStr = String(rawProbationDate); 
        }

        // Cooldown Logic (12 Months)
        let isCoolingDown = false;
        let cooldownEndDate = null;
        
        if (enrollmentData.withdrawalCount === 1 && enrollmentData.lastWithdrawalDate instanceof Date) {
          let unlockDate = new Date(enrollmentData.lastWithdrawalDate);
          unlockDate.setFullYear(unlockDate.getFullYear() + 1); 
          
          if (today < unlockDate) {
            isCoolingDown = true;
            cooldownEndDate = String(unlockDate); 
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

        return {
          success: true,
          name: data[i][nameCol],
          title: data[i][titleCol],
          hireDate: String(rawHireDate),
          allstarsId: allstarsId,
          enrollment: {
            isEnrolled: enrollmentData.isEnrolled,
            withdrawalCount: enrollmentData.withdrawalCount,
            currentPlan: enrollmentData.currentPlan,
            investmentPlan: enrollmentData.investmentPlan,
            beneficiariesJSON: enrollmentData.beneficiariesJSON,
            beneficiaryHistory: enrollmentData.beneficiaryHistory, // <-- ADD THIS LINE
            enrolledDate: enrollmentData.enrolledDate ? String(enrollmentData.enrolledDate) : null
          },
          isOnProbation: isOnProbation,
          probationEndDate: probationEndDateStr, 
          isCoolingDown: isCoolingDown,
          cooldownEndDate: cooldownEndDate, 
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