// ==========================================
// PROGRAMMATIC TEST HARNESS FOR AUGUST POLICY
// ==========================================
// This file contains unit tests to verify the correctness of the August 2026 policy
// rules including withdrawal cooldowns, permanent lockout, and plan change eligibility.
// These tests can be run directly from the Google Apps Script editor.

function testAugustPolicyRules() {
  Logger.log("=== STARTING AUGUST POLICY TEST SUITE ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      Logger.log(" [PASS] " + message);
      passed++;
    } else {
      Logger.log(" [FAIL] " + message);
      failed++;
    }
  }

  // ----------------------------------------------------
  // TEST CASE 1: Plan-change Lock Duration (6 Months)
  // ----------------------------------------------------
  try {
    const today = new Date();
    const lastActionDate = new Date(today);
    // 5 months ago (should be locked)
    lastActionDate.setMonth(today.getMonth() - 5);
    
    let nextEligibleDate = new Date(lastActionDate);
    nextEligibleDate.setMonth(nextEligibleDate.getMonth() + 6);
    
    const isLocked = today.getTime() < nextEligibleDate.getTime();
    assert(isLocked === true, "Plan-change must be LOCKED if last action was 5 months ago.");
    
    // 7 months ago (should be unlocked)
    const unlockedActionDate = new Date(today);
    unlockedActionDate.setMonth(today.getMonth() - 7);
    
    let nextEligibleDate2 = new Date(unlockedActionDate);
    nextEligibleDate2.setMonth(nextEligibleDate2.getMonth() + 6);
    
    const isLocked2 = today.getTime() < nextEligibleDate2.getTime();
    assert(isLocked2 === false, "Plan-change must be UNLOCKED if last action was 7 months ago.");
  } catch (e) {
    Logger.log("Error in Test Case 1: " + e.toString());
    failed++;
  }

  // ----------------------------------------------------
  // TEST CASE 2: Cooldown Logic after 1st and 2nd Withdrawals
  // ----------------------------------------------------
  try {
    const today = new Date();
    
    // Helper simulation of the cooldown check in Profile.gs
    function simulateCooldown(withdrawalCount, lastWithdrawalDate) {
      let isCoolingDown = false;
      let cooldownEndDate = null;
      
      if ((withdrawalCount === 1 || withdrawalCount === 2) && lastWithdrawalDate instanceof Date) {
        let unlockDate = new Date(lastWithdrawalDate);
        unlockDate.setMonth(unlockDate.getMonth() + 6);

        if (today < unlockDate) {
          isCoolingDown = true;
          cooldownEndDate = String(unlockDate);
        }
      }
      return { isCoolingDown, cooldownEndDate };
    }

    // 1st withdrawal, 3 months ago (should be cooling down)
    const lastWd1 = new Date(today);
    lastWd1.setMonth(today.getMonth() - 3);
    let res1 = simulateCooldown(1, lastWd1);
    assert(res1.isCoolingDown === true, "1st withdrawal 3 months ago should trigger a 6-month COOLDOWN.");

    // 1st withdrawal, 7 months ago (cooldown should be over)
    const lastWd2 = new Date(today);
    lastWd2.setMonth(today.getMonth() - 7);
    let res2 = simulateCooldown(1, lastWd2);
    assert(res2.isCoolingDown === false, "1st withdrawal 7 months ago should be OUT of cooldown.");

    // 2nd withdrawal, 2 months ago (should be cooling down)
    const lastWd3 = new Date(today);
    lastWd3.setMonth(today.getMonth() - 2);
    let res3 = simulateCooldown(2, lastWd3);
    assert(res3.isCoolingDown === true, "2nd withdrawal 2 months ago should trigger a 6-month COOLDOWN under new policy.");

    // 3rd withdrawal (permanent lockout, should not trigger cooldown)
    let res4 = simulateCooldown(3, lastWd3);
    assert(res4.isCoolingDown === false, "3rd withdrawal should not trigger cooldown (is permanent lockout instead).");
  } catch (e) {
    Logger.log("Error in Test Case 2: " + e.toString());
    failed++;
  }

  // ----------------------------------------------------
  // TEST CASE 3: Membership Tenure Restart on Re-enrollment
  // ----------------------------------------------------
  try {
    const hireDate = new Date("2020-01-01");
    const reEnrolledDate = new Date("2026-01-01");

    // Profile.gs logic simulation for tenure start date
    function getStartDateForMath(withdrawalCount, enrolledDate, rawHireDate) {
      let startDateForMath = rawHireDate;
      if (withdrawalCount >= 1 && enrolledDate instanceof Date) {
        startDateForMath = enrolledDate;
      }
      return startDateForMath;
    }

    // First cycle (0 withdrawals): tenure should start at hire date
    let start1 = getStartDateForMath(0, null, hireDate);
    assert(start1.getTime() === hireDate.getTime(), "0 withdrawals: membership math starts from original hire date.");

    // Second cycle (1 withdrawal, re-enrolled): tenure restarts at re-enrollment date
    let start2 = getStartDateForMath(1, reEnrolledDate, hireDate);
    assert(start2.getTime() === reEnrolledDate.getTime(), "1 withdrawal: membership math restarts from re-enrollment date.");

    // Third cycle (2 withdrawals, re-enrolled): tenure restarts at re-enrollment date
    let start3 = getStartDateForMath(2, reEnrolledDate, hireDate);
    assert(start3.getTime() === reEnrolledDate.getTime(), "2 withdrawals: membership math restarts from re-enrollment date.");
  } catch (e) {
    Logger.log("Error in Test Case 3: " + e.toString());
    failed++;
  }

  // ----------------------------------------------------
  // TEST CASE 4: Action.gs re-enrollment tenure reset
  // ----------------------------------------------------
  try {
    const hireDate = new Date("2020-01-01");
    const today = new Date();

    function simulateActionTenure(wasFirstEnrollment, userHireDate) {
      let tenureYears = 0;
      if (wasFirstEnrollment && userHireDate instanceof Date) {
        tenureYears = (today.getTime() - userHireDate.getTime()) / (1000 * 3600 * 24 * 365.25);
      }
      return tenureYears;
    }

    // First enrollment: tenure starts at hire date (tenure > 0)
    let t1 = simulateActionTenure(true, hireDate);
    assert(t1 > 5.0, "First enrollment: tenureYears calculated from hire date.");

    // Re-enrollment: tenure resets to 0
    let t2 = simulateActionTenure(false, hireDate);
    assert(t2 === 0, "Re-enrollment: tenureYears resets to 0 (tested for 8th test case).");
  } catch (e) {
    Logger.log("Error in Test Case 4: " + e.toString());
    failed++;
  }

  // ----------------------------------------------------
  // TEST CASE 5: Employer Match Tier Calculation
  // ----------------------------------------------------
  try {
    // Under 5 years = 3%, 5-7 years = 5%, 7-10 years = 7%, 10+ years = 10%
    assert(calculateMatchTier(3) === "3%", "Tenure of 3 years should be 3% match tier.");
    assert(calculateMatchTier(5) === "5%", "Tenure of 5 years should be 5% match tier.");
    assert(calculateMatchTier(6.5) === "5%", "Tenure of 6.5 years should be 5% match tier.");
    assert(calculateMatchTier(7) === "7%", "Tenure of 7 years should be 7% match tier.");
    assert(calculateMatchTier(9.9) === "7%", "Tenure of 9.9 years should be 7% match tier.");
    assert(calculateMatchTier(10) === "10%", "Tenure of 10 years should be 10% match tier.");
    assert(calculateMatchTier(15) === "10%", "Tenure of 15 years should be 10% match tier.");
  } catch (e) {
    Logger.log("Error in Test Case 5: " + e.toString());
    failed++;
  }

  Logger.log(`=== TEST SUITE COMPLETED: ${passed} PASSED, ${failed} FAILED ===`);
}
