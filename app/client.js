import { createThirdwebClient } from "thirdweb";

// Dieser "Client" ist die Verbindung zu thirdweb (dem Wallet-Dienst).
// Die Client ID kommt aus der .env.local Datei und identifiziert unser Projekt.
export const client = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID,
});
