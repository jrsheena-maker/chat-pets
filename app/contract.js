import { getContract } from "thirdweb";
import { avalancheFuji } from "thirdweb/chains";
import { client } from "./client";

// Adresse unseres EggCreature-Vertrags auf Avalanche Fuji (Testnet).
// v2: enthält die separate Feeder-Rolle (siehe contracts/EggCreature.sol).
export const EGG_CONTRACT_ADDRESS = "0xc1141a5a5dE630AEae217F23Fc54dd2Bd22D9E1d";

// Block kurz vor dem Deployment. Wir suchen Events nur ab hier statt ab Block 0 -
// eine Suche über die komplette Chain-Historie ist auf dem Testnet-RPC zu langsam
// und bleibt sonst hängen.
export const EGG_DEPLOY_BLOCK = 57823320n;

// Diese "contract"-Instanz nutzen wir überall in der App, um mit dem
// EggCreature-Vertrag zu lesen (z. B. Level) und zu schreiben (z. B. claim()).
export const eggContract = getContract({
  client,
  chain: avalancheFuji,
  address: EGG_CONTRACT_ADDRESS,
});
