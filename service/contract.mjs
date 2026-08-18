// Eigene, kleine Kopie von app/contract.js - für den Bot-Dienst, der als
// eigenständiges Node-Programm läuft (nicht über Next.js gebündelt).
// Bei einem erneuten Contract-Redeploy: hier UND in app/contract.js anpassen.
import { getContract } from "thirdweb";
import { avalancheFuji } from "thirdweb/chains";
import { thirdwebClient } from "./client.mjs";

export const EGG_CONTRACT_ADDRESS = "0xc1141a5a5dE630AEae217F23Fc54dd2Bd22D9E1d";
export const EGG_DEPLOY_BLOCK = 57823320n;

export const eggContract = getContract({
  client: thirdwebClient,
  chain: avalancheFuji,
  address: EGG_CONTRACT_ADDRESS,
});
