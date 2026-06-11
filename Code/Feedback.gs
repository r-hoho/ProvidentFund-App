// ==========================================
// APP FEEDBACK (post-action star rating)
// ==========================================
// Records a 1-5 star rating + optional comment to the App_Feedback sheet after
// a user completes an action successfully. The sheet must exist with headers:
// Timestamp | Allstars_ID | Email | Action | Rating | Comment
//
// Best-effort by design: this is called AFTER the action has already succeeded,
// so a feedback failure must never surface as an error that implies the action
// failed. Returns {success} but the frontend ignores failures silently.

/**
 * Appends a feedback row. payload: { action, rating (1-5), comment }.
 * Identity (Allstars_ID + email) is resolved server-side, not trusted from the client.
 */
function submitFeedback(payload) {
  try {
    const email = Session.getActiveUser().getEmail() || "";

    const rating = parseInt(payload && payload.rating, 10);
    if (!rating || rating < 1 || rating > 5) {
      return { success: false, msg: "Invalid rating" };
    }
    const comment = (payload && payload.comment ? String(payload.comment) : "").slice(0, 1000);
    const action = (payload && payload.action) ? String(payload.action) : "";

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_FEEDBACK);
    if (!sheet) return { success: false, msg: "App_Feedback sheet not found" };

    // Resolve Allstars_ID from the Users sheet (best-effort; blank if not found).
    let allstarsId = "";
    try {
      const usersData = ss.getSheetByName(SHEET_USERS).getDataRange().getValues();
      const emailCol = usersData[0].indexOf("Work_Email");
      const idCol = usersData[0].indexOf("Allstars_ID");
      for (let i = 1; i < usersData.length; i++) {
        if (usersData[i][emailCol].toString().trim().toLowerCase() === email.toLowerCase()) {
          allstarsId = usersData[i][idCol];
          break;
        }
      }
    } catch (e) { /* leave blank */ }

    appendRowToSheet(sheet, {
      "Timestamp": new Date(),
      "Allstars_ID": allstarsId,
      "Email": email,
      "Action": action,
      "Rating": rating,
      "Comment": comment
    });

    return { success: true };
  } catch (e) {
    return { success: false, msg: e.toString() };
  }
}
