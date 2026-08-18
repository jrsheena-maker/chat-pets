"use client";

import { useEffect, useState } from "react";
import {
  ConnectButton,
  useActiveAccount,
  useReadContract,
  useSendTransaction,
} from "thirdweb/react";
import { inAppWallet } from "thirdweb/wallets";
import { avalancheFuji } from "thirdweb/chains";
import {
  getContractEvents,
  prepareContractCall,
  prepareEvent,
  readContract,
  waitForReceipt,
} from "thirdweb";
import { client } from "./client";
import { eggContract, EGG_DEPLOY_BLOCK } from "./contract";

// Hier legen wir fest: Login per E-Mail, Google oder Apple.
// Keine Seed-Phrase, kein Krypto-Wallet-Popup - fühlt sich wie ein normaler Login an.
const wallets = [
  inAppWallet({
    auth: {
      options: ["email", "google", "apple"],
    },
  }),
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export default function Home() {
  const account = useActiveAccount();

  // Prüft on-chain, ob diese Wallet bereits ein Ei geclaimt hat.
  const {
    data: hasClaimed,
    isLoading: isCheckingClaim,
    refetch: refetchHasClaimed,
  } = useReadContract({
    contract: eggContract,
    method: "function hasClaimed(address) view returns (bool)",
    params: [account?.address ?? ZERO_ADDRESS],
    queryOptions: { enabled: !!account },
  });

  // Sobald geclaimt: über den Mint-Event (Transfer von der Nullwallet) herausfinden,
  // welche Token-ID der Wallet gehört, und dafür das aktuelle Level lesen.
  // status: "idle" | "loading" | "ready" | "not_found" | "error"
  const [egg, setEgg] = useState({ status: "idle", level: null });

  useEffect(() => {
    if (!account || !hasClaimed) {
      setEgg({ status: "idle", level: null });
      return;
    }

    let cancelled = false;
    setEgg({ status: "loading", level: null });

    (async () => {
      const transferToMe = prepareEvent({
        signature:
          "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
        filters: { to: account.address },
      });

      // Nur ab dem Deployment-Block suchen, nicht ab Block 0 - sonst dauert die
      // Abfrage auf dem Testnet-RPC viel zu lange / bleibt hängen.
      const events = await getContractEvents({
        contract: eggContract,
        events: [transferToMe],
        fromBlock: EGG_DEPLOY_BLOCK,
      });

      const lastTransfer = events[events.length - 1];
      if (!lastTransfer) {
        if (!cancelled) setEgg({ status: "not_found", level: null });
        return;
      }

      const level = await readContract({
        contract: eggContract,
        method: "function levelOf(uint256) view returns (uint256)",
        params: [lastTransfer.args.tokenId],
      });

      if (!cancelled) setEgg({ status: "ready", level });
    })().catch((error) => {
      console.error("Konnte Ei-Level nicht laden:", error);
      if (!cancelled) setEgg({ status: "error", level: null });
    });

    return () => {
      cancelled = true;
    };
  }, [account, hasClaimed]);

  // Erzeugt einen Code, mit dem man im Blaze-Chat "!link CODE" tippt, um den
  // Chat-Account mit dieser Wallet zu verknüpfen (getrennt vom NFT-Besitz).
  const [link, setLink] = useState({ status: "idle", code: null });

  const handleRequestLink = async () => {
    if (!account) return;
    setLink({ status: "loading", code: null });
    try {
      const res = await fetch("/api/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: account.address }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();
      setLink({ status: "ready", code: data.code });
    } catch (error) {
      console.error("Konnte Link-Code nicht anfragen:", error);
      setLink({ status: "error", code: null });
    }
  };

  const { mutate: sendTransaction, isPending: isSending } = useSendTransaction();
  const [claimError, setClaimError] = useState(null);
  // Bleibt "true", bis die Transaktion wirklich auf der Blockchain bestätigt
  // ist - nicht nur verschickt. isSending (vom Hook) wird schon vorher false,
  // sobald die Transaktion abgeschickt wurde, das reicht hier nicht aus.
  const [isConfirming, setIsConfirming] = useState(false);
  const isClaiming = isSending || isConfirming;

  const handleClaim = () => {
    setClaimError(null);
    const transaction = prepareContractCall({
      contract: eggContract,
      method: "function claim()",
      params: [],
    });
    sendTransaction(transaction, {
      onSuccess: async (result) => {
        setIsConfirming(true);
        try {
          // Wichtig: erst warten, bis die Transaktion wirklich in einem Block
          // bestätigt ist - sonst denkt die Seite noch kurz, es gäbe kein Ei.
          await waitForReceipt({
            client,
            chain: avalancheFuji,
            transactionHash: result.transactionHash,
          });
          // Ein frisch geclaimtes Ei hat immer Level 0 - das zeigen wir sofort an,
          // statt auf die (manchmal langsame) Blockchain-Abfrage zu warten.
          setEgg({ status: "ready", level: 0n });
          await refetchHasClaimed();
        } catch (error) {
          console.error("Warten auf Bestätigung fehlgeschlagen:", error);
          setClaimError(error?.message ?? "Unknown error");
        } finally {
          setIsConfirming(false);
        }
      },
      onError: (error) => {
        // Fehlertext auf der Seite anzeigen + volles Detail in der Browser-Konsole,
        // damit man beim Debuggen sieht, woran es genau lag.
        console.error("claim() ist fehlgeschlagen:", error);
        setClaimError(error?.message ?? "Unknown error");
      },
    });
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        textAlign: "center",
        gap: "8px",
      }}
    >
      <div style={{ fontSize: "64px", lineHeight: 1 }}>🥚</div>

      <h1
        style={{
          fontSize: "28px",
          fontWeight: 700,
          margin: "16px 0 4px",
          letterSpacing: "-0.02em",
        }}
      >
        Community Creatures
      </h1>

      <p
        style={{
          color: "var(--text-dim)",
          maxWidth: "360px",
          margin: "0 0 28px",
          fontSize: "15px",
        }}
      >
        Log in to get your own egg. It evolves as the chat feeds it.
      </p>

      <ConnectButton
        client={client}
        wallets={wallets}
        chain={avalancheFuji}
        theme="dark"
        connectModal={{ size: "compact" }}
        connectButton={{ label: "Log in" }}
      />

      {account && !isCheckingClaim && hasClaimed === false && (
        <button
          onClick={handleClaim}
          disabled={isClaiming}
          style={{
            marginTop: "20px",
            padding: "12px 24px",
            fontSize: "15px",
            fontWeight: 600,
            borderRadius: "8px",
            border: "none",
            cursor: isClaiming ? "default" : "pointer",
            opacity: isClaiming ? 0.7 : 1,
            background: "var(--gold)",
            color: "var(--bg)",
          }}
        >
          {isClaiming ? "Claiming..." : "Claim your egg"}
        </button>
      )}

      {claimError && (
        <p
          style={{
            marginTop: "12px",
            fontSize: "13px",
            color: "#e08a8a",
            maxWidth: "360px",
          }}
        >
          {claimError}
        </p>
      )}

      {account && hasClaimed === true && (
        <p
          style={{
            marginTop: "24px",
            fontSize: "18px",
            fontWeight: 700,
            color: "var(--green)",
          }}
        >
          {egg.status === "loading" && "Loading your egg..."}
          {egg.status === "ready" && `Your Egg - Level ${egg.level.toString()}`}
          {egg.status === "not_found" &&
            "You have an egg, but it could not be found yet. Try reloading in a moment."}
          {egg.status === "error" &&
            "Could not load your egg right now. Please try reloading the page."}
        </p>
      )}

      {account && hasClaimed === true && (
        <div style={{ marginTop: "20px" }}>
          {link.status !== "ready" && (
            <button
              onClick={handleRequestLink}
              disabled={link.status === "loading"}
              style={{
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 600,
                borderRadius: "8px",
                border: "1px solid var(--border)",
                cursor: link.status === "loading" ? "default" : "pointer",
                background: "var(--panel)",
                color: "var(--text)",
              }}
            >
              {link.status === "loading" ? "Generating code..." : "Link your Blaze chat name"}
            </button>
          )}

          {link.status === "ready" && (
            <p style={{ fontSize: "14px", maxWidth: "360px" }}>
              Type{" "}
              <strong style={{ color: "var(--gold)" }}>!link {link.code}</strong>{" "}
              in the Blaze chat within 10 minutes to link your chat account to this egg.
            </p>
          )}

          {link.status === "error" && (
            <p style={{ fontSize: "13px", color: "#e08a8a" }}>
              Could not generate a code. Please try again.
            </p>
          )}
        </div>
      )}

      {account && (
        <p
          style={{
            marginTop: "8px",
            fontSize: "12px",
            color: "var(--text-dim)",
            wordBreak: "break-all",
            maxWidth: "360px",
          }}
        >
          Wallet: {account.address}
        </p>
      )}
    </main>
  );
}
