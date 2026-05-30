// ==========================================
// ACTION CONFIRMATION EMAILS
// ==========================================
// Bilingual (Thai first, then English) plain-text confirmation emails sent to
// the acting user on each action. See "Proposal - Email Confirmations and
// Signed Letters.md" §4 for the agreed layout.
//
// Phase B wires only Change Plan SUBMITTED. Other action/event strings are
// added in buildEmailContent() as each handler is wired (Phase C onward).

/**
 * Sends a bilingual confirmation email to the acting user. NEVER throws — a
 * mail failure must not break the user's action. Returns a result the caller
 * can log to Audit_Log.Event_Data (emailSent / emailError).
 *
 * @param {Object} p
 * @param {string} p.userEmail   Recipient (the acting user).
 * @param {string} p.userName    Name_English, for the greeting.
 * @param {string} p.actionType  "Change Plan" | "Enroll" | "Withdraw" | ...
 * @param {string} p.eventType   "SUBMITTED" | "CANCELLED"
 * @param {Object} p.details     Action-specific fields; must include transactionId.
 * @param {string} [p.attachmentFileId]  Drive file id of a PDF to attach (unused until letters land).
 * @return {{sent: boolean, error?: string}}
 */
function sendActionConfirmation(p) {
  try {
    const content = buildEmailContent(p.actionType, p.eventType, p.details);
    const submittedAt = Utilities.formatDate(new Date(), "Asia/Bangkok", "dd MMM yyyy, HH:mm");

    const thai = [
      `สวัสดีคุณ ${p.userName},`,
      ``,
      `ระบบได้รับคำขอของคุณแล้ว:`,
      `  ประเภท: ${content.thaiAction}`,
    ]
      .concat(content.thaiDetails.map(d => `  ${d}`))
      .concat([
        `  รหัสรายการ: ${p.details.transactionId}`,
        `  เวลาที่ส่ง: ${submittedAt} น.`,
      ])
      .join("\n");

    const en = [
      `Hi ${p.userName},`,
      ``,
      `Your request has been received:`,
      `  Action: ${content.enAction}`,
    ]
      .concat(content.enDetails.map(d => `  ${d}`))
      .concat([
        `  Transaction ID: ${p.details.transactionId}`,
        `  Submitted at: ${submittedAt} (Bangkok)`,
      ])
      .join("\n");

    const body = `${thai}\n\n---\n\n${en}\n\n— Allstars Provident Fund System`;
    const subject = `[กองทุนสำรองเลี้ยงชีพ / Provident Fund] ${content.subject}`;

    const options = { name: "Allstars Provident Fund" };
    if (p.attachmentFileId) {
      options.attachments = [DriveApp.getFileById(p.attachmentFileId).getBlob()];
    }

    MailApp.sendEmail(p.userEmail, subject, body, options);
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.toString() };
  }
}

/**
 * Returns the bilingual subject + per-action detail lines for an action/event.
 * thaiDetails / enDetails are the middle lines (รายละเอียด, วันที่มีผล, ...) —
 * the greeting, transaction id, and submitted-at lines are added by the caller.
 */
function buildEmailContent(actionType, eventType, details) {
  const pct = v => (parseFloat(v) * 100).toFixed(0) + "%";

  if (actionType === "Change Plan" && eventType === "SUBMITTED") {
    return {
      subject: "ยืนยันการเปลี่ยนอัตราสะสม / Contribution Change Confirmation",
      thaiAction: "เปลี่ยนอัตราเงินสะสม",
      thaiDetails: [
        `รายละเอียด: จาก ${pct(details.oldPct)} เป็น ${pct(details.newPct)}`,
        `วันที่มีผล: ${details.effectiveDate}`,
      ],
      enAction: "Contribution rate change",
      enDetails: [
        `Details: from ${pct(details.oldPct)} to ${pct(details.newPct)}`,
        `Effective date: ${details.effectiveDate}`,
      ],
    };
  }

  // Fallback for actions not yet wired (Phase C onward) — generic acknowledgement
  // so an unexpected call still sends something sensible rather than throwing.
  return {
    subject: "ยืนยันรายการ / Action Confirmation",
    thaiAction: actionType,
    thaiDetails: [],
    enAction: actionType,
    enDetails: [],
  };
}
