import { SendEmailCommand } from "@aws-sdk/client-ses";
import { ses } from "@/lib/aws/clients";

export type RiskAlertEmail = {
  to: string;
  supplierName: string;
  supplierCode: string;
  eventType: string;
  severity: string;
  headline: string;
  summary?: string | null;
  url?: string | null;
};

/**
 * Notify the procurement manager. Uses Amazon SES when ALERT_FROM_EMAIL is
 * configured; otherwise logs (so local dev and demos work without SES).
 * Returns true when the notification was actually dispatched.
 */
export async function sendRiskAlertEmail(a: RiskAlertEmail): Promise<boolean> {
  const from = process.env.ALERT_FROM_EMAIL;
  const subject = `[SAINT] ${a.severity} supplier risk — ${a.eventType} — ${a.supplierName}`;
  const body = [
    `Supplier : ${a.supplierName} (${a.supplierCode})`,
    `Event    : ${a.eventType}`,
    `Severity : ${a.severity}`,
    ``,
    a.headline,
    a.summary ?? "",
    a.url ? `\nSource: ${a.url}` : "",
    ``,
    `Recommended action: review open POs, contract exposure and single-source dependency for this supplier.`,
  ].join("\n");

  if (!from) {
    console.warn(`[alert:not-sent ALERT_FROM_EMAIL unset] to=${a.to} :: ${subject}`);
    return false;
  }

  try {
    await ses.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [a.to] },
        Message: {
          Subject: { Data: subject },
          Body: { Text: { Data: body } },
        },
      })
    );
    return true;
  } catch (e) {
    console.error("SES send failed", e);
    return false;
  }
}
