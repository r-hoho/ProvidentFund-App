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

    // The cancel-line is shown only for SUBMITTED events of CANCELLABLE actions.
    // Beneficiary/investment updates are effective immediately and have no cancel
    // state, so they must not promise a cancel option.
    const CANCELLABLE = ["Enroll", "Change Plan", "Withdraw"];
    const showCancelLine = p.eventType === "SUBMITTED" && CANCELLABLE.indexOf(p.actionType) !== -1;

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
      .concat(showCancelLine ? [`  หากต้องการยกเลิกคำขอนี้ กรุณาเข้าสู่ระบบแอปพลิเคชัน`] : [])
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
      .concat(showCancelLine ? [`  To cancel this request, please visit the application.`] : [])
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

  // Bilingual labels for each action, reused across SUBMITTED and CANCELLED copy.
  const ACTION_LABELS = {
    "Enroll":      { th: "สมัครสมาชิกกองทุน",        en: "Enrollment" },
    "Change Plan": { th: "เปลี่ยนอัตราเงินสะสม",       en: "Contribution rate change" },
    "Withdraw":    { th: "ลาออกจากกองทุน (ถอนเงิน)",   en: "Withdrawal from fund" },
  };

  // ----- Enroll SUBMITTED -----
  // PDF letter is attached by the caller (attachmentFileId); the body notes it.
  if (actionType === "Enroll" && eventType === "SUBMITTED") {
    return {
      subject: "ยืนยันการสมัครสมาชิกกองทุน / Enrollment Confirmation",
      thaiAction: ACTION_LABELS["Enroll"].th,
      thaiDetails: [
        `อัตราเงินสะสม: ${pct(details.planPct)}`,
        `แผนการลงทุน: ${details.investmentPlan}`,
        `วันที่มีผล: ${details.effectiveDate}`,
        `(แนบจดหมายยืนยันที่ลงนามแล้วในอีเมลฉบับนี้)`,
      ],
      enAction: ACTION_LABELS["Enroll"].en,
      enDetails: [
        `Contribution rate: ${pct(details.planPct)}`,
        `Investment plan: ${details.investmentPlan}`,
        `Effective date: ${details.effectiveDate}`,
        `(A signed confirmation letter is attached to this email)`,
      ],
    };
  }

  // ----- CANCELLED (any cancellable action) -----
  // References the original transaction (the caller passes the original id) and
  // states no changes were applied. Vesting/other detail intentionally omitted.
  if (eventType === "CANCELLED") {
    const label = ACTION_LABELS[actionType] || { th: actionType, en: actionType };
    return {
      subject: "ยืนยันการยกเลิกรายการ / Cancellation Confirmation",
      thaiAction: "ยกเลิกรายการ",
      thaiDetails: [
        `รายการที่ยกเลิก: ${label.th}`,
      ],
      enAction: "Cancellation",
      enDetails: [
        `Cancelled action: ${label.en}`,
      ],
    };
  }

  // ----- Update Beneficiaries SUBMITTED -----
  // Effective immediately (no cancel state). Lists the full new beneficiary set.
  // PDF letter is attached by the caller (attachmentFileId); the body notes it.
  if (actionType === "Update Beneficiaries" && eventType === "SUBMITTED") {
    const benList = (details.beneficiaries || []).map(b => `- ${b.name} (${b.rel}) — ${b.pct}%`);
    return {
      subject: "ยืนยันการปรับปรุงผู้รับผลประโยชน์ / Beneficiary Update Confirmation",
      thaiAction: "ปรับปรุงรายชื่อผู้รับผลประโยชน์",
      thaiDetails: ["รายชื่อผู้รับผลประโยชน์:"]
        .concat(benList)
        .concat(["(แนบจดหมายยืนยันที่ลงนามแล้วในอีเมลฉบับนี้)"]),
      enAction: "Beneficiary update",
      enDetails: ["Beneficiaries:"]
        .concat(benList)
        .concat(["(A signed confirmation letter is attached to this email)"]),
    };
  }

  // ----- Change Plan SUBMITTED -----
  if (actionType === "Change Plan" && eventType === "SUBMITTED") {
    return {
      subject: "ยืนยันการเปลี่ยนอัตราสะสม / Contribution Change Confirmation",
      thaiAction: ACTION_LABELS["Change Plan"].th,
      thaiDetails: [
        `รายละเอียด: จาก ${pct(details.oldPct)} เป็น ${pct(details.newPct)}`,
        `วันที่มีผล: ${details.effectiveDate}`,
      ],
      enAction: ACTION_LABELS["Change Plan"].en,
      enDetails: [
        `Details: from ${pct(details.oldPct)} to ${pct(details.newPct)}`,
        `Effective date: ${details.effectiveDate}`,
      ],
    };
  }

  // ----- Withdraw SUBMITTED -----
  // No vesting line: vesting is acknowledged in the modal before submit, so the
  // receipt does not repeat it.
  if (actionType === "Withdraw" && eventType === "SUBMITTED") {
    return {
      subject: "ยืนยันการลาออกจากกองทุน / Withdrawal Confirmation",
      thaiAction: ACTION_LABELS["Withdraw"].th,
      thaiDetails: [
        `วันที่มีผล: ${details.effectiveDate}`,
      ],
      enAction: ACTION_LABELS["Withdraw"].en,
      enDetails: [
        `Effective date: ${details.effectiveDate}`,
      ],
    };
  }

  // Fallback for actions not yet wired (enrollment/beneficiary land in E/F) —
  // generic acknowledgement so an unexpected call still sends something sensible.
  return {
    subject: "ยืนยันรายการ / Action Confirmation",
    thaiAction: actionType,
    thaiDetails: [],
    enAction: actionType,
    enDetails: [],
  };
}
