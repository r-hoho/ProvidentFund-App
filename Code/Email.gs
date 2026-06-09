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

    // Web-app URL for the "open application" button (best-effort; empty if the
    // script isn't deployed as a web app or the URL can't be read).
    let appUrl = "";
    try { appUrl = ScriptApp.getService().getUrl() || ""; } catch (e) { appUrl = ""; }

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

    const htmlBody = buildHtmlEmail({
      userName: p.userName,
      content: content,
      txId: p.details.transactionId,
      submittedAt: submittedAt,
      showCancelLine: showCancelLine,
      appUrl: appUrl,
    });

    const options = { name: "Allstars Provident Fund", htmlBody: htmlBody };
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
 * Sends a second email when the signed-PDF letter could not be generated, even
 * though the user's action itself succeeded and was recorded. Goes to the admin
 * and CCs the user so both sides know a document is owed. NEVER throws — this is
 * best-effort notification and must not affect the action's result.
 *
 * @param {Object} p
 * @param {string} p.userEmail      The acting user (CC'd).
 * @param {string} p.userName       Name_English, for the greeting.
 * @param {string} p.actionType     "Enroll" | "Update Beneficiaries"
 * @param {string} p.transactionId  Audit transaction id.
 * @param {string} p.error          Raw letterError string (for diagnostics).
 * @return {{sent: boolean, error?: string}}
 */
function sendLetterFailureAlert(p) {
  try {
    const adminEmail = "navananyeamsiri@airasia.com";
    const at = Utilities.formatDate(new Date(), "Asia/Bangkok", "dd MMM yyyy, HH:mm");
    const ACTION_TH = {
      "Enroll": "สมัครสมาชิกกองทุน",
      "Update Beneficiaries": "ปรับปรุงรายชื่อผู้รับผลประโยชน์",
    };
    const actTh = ACTION_TH[p.actionType] || p.actionType;

    const subject = `[กองทุนสำรองเลี้ยงชีพ / Provident Fund] สร้างเอกสารไม่สำเร็จ / Letter generation failed — ${p.transactionId}`;

    const thai = [
      `เรียน ผู้ดูแลระบบ,`,
      ``,
      `ระบบไม่สามารถสร้างเอกสารยืนยัน (PDF) สำหรับรายการต่อไปนี้ได้`,
      `รายการของผู้ใช้ถูกบันทึกเรียบร้อยแล้ว — มีเพียงไฟล์ PDF เท่านั้นที่ยังสร้างไม่สำเร็จ`,
      ``,
      `  ผู้ใช้: ${p.userName} (${p.userEmail})`,
      `  ประเภทรายการ: ${actTh}`,
      `  รหัสรายการ: ${p.transactionId}`,
      `  เวลา: ${at} น.`,
      `  ข้อผิดพลาด: ${p.error}`,
      ``,
      `กรุณาตรวจสอบและจัดทำเอกสารให้ผู้ใช้อีกครั้ง`,
    ].join("\n");

    const en = [
      `Dear Admin,`,
      ``,
      `A confirmation letter (PDF) could not be generated for the transaction below.`,
      `The user's action was completed and recorded normally — only the PDF failed.`,
      ``,
      `  User: ${p.userName} (${p.userEmail})`,
      `  Action: ${p.actionType}`,
      `  Transaction ID: ${p.transactionId}`,
      `  Time: ${at} (Bangkok)`,
      `  Error: ${p.error}`,
      ``,
      `Please follow up and re-issue the document to the user.`,
    ].join("\n");

    const body = `${thai}\n\n---\n\n${en}\n\n— Allstars Provident Fund System`;

    MailApp.sendEmail({
      to: adminEmail,
      cc: p.userEmail,
      name: "Allstars Provident Fund",
      subject: subject,
      body: body,
    });
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

// ==========================================
// HTML EMAIL TEMPLATE
// ==========================================
// Minimal, single-accent (red) HTML body matching the plain-text content. Uses
// table layout + inline styles only (email-client safe — no <style>, flexbox,
// or external CSS). Thai block first, divider, then English, mirroring the
// plain-text fallback. PF_EMAIL_ACCENT is the single colour to tweak.

const PF_EMAIL_ACCENT = "#FF0000"; // primary red — Pantone 485C (R255 G0 B0)

/** Escapes the 4 HTML-significant chars so dynamic values can't break layout. */
function escapeHtml(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Builds the bilingual HTML email body.
 * @param {Object} o  { userName, content, txId, submittedAt, showCancelLine, appUrl }
 * @return {string} full HTML document
 */
function buildHtmlEmail(o) {
  const A = PF_EMAIL_ACCENT;

  function block(isTh) {
    const greeting = isTh ? `สวัสดีคุณ ${escapeHtml(o.userName)},` : `Hi ${escapeHtml(o.userName)},`;
    const intro    = isTh ? "ระบบได้รับคำขอของคุณแล้ว" : "Your request has been received";
    const actLabel = isTh ? "ประเภท" : "Action";
    const action   = isTh ? o.content.thaiAction : o.content.enAction;
    const details  = isTh ? o.content.thaiDetails : o.content.enDetails;
    const idLabel  = isTh ? "รหัสรายการ" : "Transaction ID";
    const timeLabel= isTh ? "เวลาที่ส่ง" : "Submitted at";
    const timeVal  = isTh ? `${escapeHtml(o.submittedAt)} น.` : `${escapeHtml(o.submittedAt)} (Bangkok)`;
    const cancelTxt= isTh ? "หากต้องการยกเลิกคำขอนี้ กรุณาเข้าสู่ระบบแอปพลิเคชัน"
                          : "To cancel this request, please open the application.";
    const btnTxt   = isTh ? "เปิดแอปพลิเคชัน" : "Open application";

    const detailRows = (details || [])
      .map(d => `<div style="margin:3px 0;">${escapeHtml(d)}</div>`).join("");

    let cancel = "";
    if (o.showCancelLine) {
      cancel = `<div style="margin-top:16px;color:#555;">${cancelTxt}</div>`;
      if (o.appUrl) {
        cancel += `<div style="margin-top:12px;"><a href="${escapeHtml(o.appUrl)}" `
          + `style="display:inline-block;background:${A};color:#ffffff;text-decoration:none;`
          + `font-size:14px;padding:10px 22px;border-radius:6px;">${btnTxt}</a></div>`;
      }
    }

    return `
      <div style="font-weight:bold;margin-bottom:4px;">${greeting}</div>
      <div style="margin-bottom:14px;color:#555;">${intro}</div>
      <div style="background:#f7f7f7;border-radius:6px;padding:14px 16px;">
        <div style="margin:3px 0;">${actLabel}: <strong>${escapeHtml(action)}</strong></div>
        ${detailRows}
        <div style="margin-top:12px;color:#888;font-size:12px;line-height:1.5;">
          ${idLabel}: ${escapeHtml(o.txId)}<br>${timeLabel}: ${timeVal}
        </div>
      </div>
      ${cancel}`;
  }

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-top:4px solid ${A};font-family:Arial,Helvetica,sans-serif;color:#222;font-size:14px;line-height:1.6;">
          <tr><td style="padding:22px 32px 4px;">
            <div style="font-size:15px;font-weight:bold;color:${A};">กองทุนสำรองเลี้ยงชีพ / Provident Fund</div>
          </td></tr>
          <tr><td style="padding:12px 32px 24px;">
            ${block(true)}
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
            ${block(false)}
          </td></tr>
          <tr><td style="padding:16px 32px;background:#fafafa;color:#999;font-size:12px;line-height:1.5;border-top:1px solid #eee;">
            อีเมลนี้จัดทำโดยระบบอัตโนมัติ โปรดอย่าตอบกลับ<br>
            This is an automated message — please do not reply.<br>
            — Allstars Provident Fund System
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}
