// ==========================================
// LOGIN ERROR REPORTING
// ==========================================
function reportIssueToAdmin() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const adminEmail = "navananyeamsiri@airasia.com"; 
    
    const subject = `Provident Fund App: User Not Found - ${userEmail}`;
    const body = `Hello Admin,\n\nThe email '${userEmail}' is trying to login to the Provident Fund App but was not found in the database. Please check.\n\nThank you.`;
    
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
// Calculate Employer Match
// ==========================================

function calculateMatchTier(years) {
  if (years < 5) return "3%";
  if (years < 7) return "5%";
  if (years < 10) return "7%";
  return "10%";
}