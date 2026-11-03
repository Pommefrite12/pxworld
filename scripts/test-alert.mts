// Sends one test alert to ALERT_WEBHOOK_URL, to see it arrive where somebody will read it.
//   ALERT_WEBHOOK_URL=https://hooks.example/… npx tsx scripts/test-alert.mts
import { raiseAlert } from "../src/lib/alerts";

const result = await raiseAlert("test-alert", { from: "scripts/test-alert.mts", note: "if you read this, alerts reach you" });
console.log(result === "sent" ? "Sent: look at your channel." : result === "logged" ? "Only logged: ALERT_WEBHOOK_URL is missing, not an https address, or the address refused the message." : result);
process.exit(result === "sent" ? 0 : 1);
