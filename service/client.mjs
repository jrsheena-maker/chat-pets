// thirdweb-Client für den Bot-Dienst. Erwartet, dass .env.local schon
// geladen wurde (siehe feed-bot.mjs), bevor diese Datei importiert wird.
import { createThirdwebClient } from "thirdweb";

export const thirdwebClient = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID,
});
