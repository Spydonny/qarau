import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getWallets } from "@wallet-standard/app";
import { SolanaSignAndSendTransaction, SolanaSignMessage } from "@solana/wallet-standard-features";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { v1 } from "../api/client";
import qarauLockup from "../assets/qarau/primary-lockup-on-dark.png";

type MarketPackage = { package_id: string; title: string; description: string; sale_address: string; max_seats: number; occupied_seats: number; price_lamports: number | null };
type Connected = { wallet: Wallet; account: WalletAccount; address: string };
type ConnectFeature = { connect: () => Promise<readonly WalletAccount[]> };
type MessageFeature = { signMessage: (input: { account: WalletAccount; message: Uint8Array }) => Promise<readonly { signature: Uint8Array }[]> };
type SendFeature = { signAndSendTransaction: (input: { account: WalletAccount; transaction: Uint8Array; chain: "solana:devnet"; options: { commitment: "finalized" } }) => Promise<readonly { signature: Uint8Array }[]> };

function base64ToBytes(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
function base64(bytes: Uint8Array) { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }
function base58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) { let carry = byte; for (let i = 0; i < digits.length; i += 1) { carry += digits[i] << 8; digits[i] = carry % 58; carry = Math.floor(carry / 58); } while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); } }
  let result = ""; for (const byte of bytes) { if (byte !== 0) break; result += "1"; } for (let i = digits.length - 1; i >= 0; i -= 1) result += alphabet[digits[i]];
  return result;
}
function solanaWallets() { return getWallets().get().filter((wallet) => wallet.chains.includes("solana:devnet")); }
function short(address: string) { return `${address.slice(0, 5)}…${address.slice(-5)}`; }

/** A browser wallet owns both SIWS signatures and SOL purchases. No secret key reaches QARAU. */
export function WalletPage() {
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [packages, setPackages] = useState<MarketPackage[]>([]);
  const [tier, setTier] = useState<"exclusive_early" | "delayed">("exclusive_early");
  const [notice, setNotice] = useState("Connect a Devnet wallet to sign in.");
  const [busy, setBusy] = useState(false);

  const refresh = () => { setWallets(solanaWallets()); v1.marketplace().then((data) => setPackages((data.packages as unknown as MarketPackage[]) || [])).catch(() => setNotice("Marketplace is temporarily unavailable.")); };
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 3_000); return () => window.clearInterval(timer); }, []);

  const authenticate = async (wallet: Wallet, account: WalletAccount) => {
    const address = account.address;
    const signing = wallet.features[SolanaSignMessage] as MessageFeature | undefined;
    if (!signing) throw new Error("wallet_does_not_support_message_signing");
    const challenge = await v1.siwsChallenge(address);
    const signed = await signing.signMessage({ account, message: new TextEncoder().encode(challenge.message) });
    const signature = signed[0]?.signature;
    if (!signature) throw new Error("wallet_did_not_return_signature");
    await v1.siwsVerify({ address, nonce: challenge.nonce, signature: base64(signature) });
    setConnected({ wallet, account, address });
    setNotice(`Authenticated as ${short(address)}. The session is an HttpOnly server cookie.`);
  };
  const connect = async (wallet: Wallet) => {
    try {
      setBusy(true); setNotice("Requesting wallet connection and SIWS signature…");
      const feature = wallet.features["standard:connect"] as ConnectFeature | undefined;
      if (!feature) throw new Error("wallet_does_not_support_connection");
      const accounts = await feature.connect();
      const account = accounts.find((item) => item.chains.includes("solana:devnet"));
      if (!account) throw new Error("wallet_has_no_devnet_account");
      await authenticate(wallet, account);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Wallet connection failed."); }
    finally { setBusy(false); }
  };
  const purchase = async (item: MarketPackage) => {
    if (!connected) return;
    try {
      setBusy(true); setNotice("Building unsigned purchase transaction…");
      const unsigned = await v1.purchaseTransaction(item.sale_address, tier);
      const sender = connected.wallet.features[SolanaSignAndSendTransaction] as SendFeature | undefined;
      if (!sender) throw new Error("wallet_does_not_support_sign_and_send");
      setNotice("Your wallet is signing and sending the SOL purchase to Devnet…");
      const sent = await sender.signAndSendTransaction({ account: connected.account, transaction: base64ToBytes(unsigned.transaction_base64), chain: "solana:devnet", options: { commitment: "finalized" } });
      const signature = sent[0]?.signature;
      if (!signature) throw new Error("wallet_did_not_return_transaction_signature");
      setNotice("Waiting for finalized on-chain AccessGrant…");
      const confirmed = await v1.confirmPurchase(base58(signature));
      setNotice(`Purchase finalized. Access grant ${short(confirmed.grant_pda)} now controls delivery.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Purchase failed."); }
    finally { setBusy(false); }
  };

  return <div className="marketplace">
    <header className="market-nav"><div className="shell market-nav-inner"><Link to="/marketplace" className="market-brand" aria-label="Back to Qarau marketplace"><img src={qarauLockup} width={447} height={71} alt="Qarau" /><span className="meta">/ Wallet access</span></Link><span className="meta market-network"><span className="nav-owner-dot" aria-hidden="true" /> Devnet only</span></div></header>
    <main className="shell market-main">
      <section className="market-hero"><p className="meta">Wallet authentication and purchase</p><h1 className="display-sm">Your wallet signs. QARAU verifies.</h1><p className="body market-lead">A wallet signature creates the session. A separately signed Devnet transaction creates an on-chain AccessGrant. Private data never depends on a client-side paid flag.</p></section>
      <section className="market-state"><div><p className="meta">01 / Connect and sign in</p><h2 className="h2">{connected ? `Connected / ${short(connected.address)}` : wallets.length ? "Select a Devnet wallet" : "No compatible wallet detected"}</h2></div><p className="body-sm">{connected ? "You can now request an unsigned purchase transaction for a published package." : "Install or unlock a Wallet Standard-compatible Solana wallet, then return here."}</p>{!connected && wallets.length > 0 && <div className="source-actions" style={{ marginTop: 18 }}>{wallets.map((wallet) => <button className="btn btn-primary" disabled={busy} key={wallet.name} onClick={() => connect(wallet)}>Connect {wallet.name}</button>)}</div>}</section>
      <section className="market-state"><div><p className="meta">02 / Purchase an access tier</p><h2 className="h2">Published Devnet packages</h2></div><div className="source-actions"><button className={`opt ${tier === "exclusive_early" ? "is-active" : ""}`} onClick={() => setTier("exclusive_early")}>Exclusive / early</button><button className={`opt ${tier === "delayed" ? "is-active" : ""}`} onClick={() => setTier("delayed")}>Delayed</button></div>{packages.map((item) => <article className="market-package" key={item.package_id}><p className="meta">PACKAGE / {item.package_id.slice(-8).toUpperCase()}</p><h2 className="h2">{item.title}</h2><p className="body-sm">{item.description}</p><p className="meta">{item.max_seats - item.occupied_seats} / {item.max_seats} seats remaining · {item.price_lamports?.toLocaleString("en-US") ?? "—"} lamports</p><button className="btn btn-primary" disabled={!connected || busy || item.occupied_seats >= item.max_seats} onClick={() => purchase(item)}>{busy ? "Working…" : `Buy ${tier === "exclusive_early" ? "early" : "delayed"} access`}</button></article>)}{!packages.length && <p className="body-sm">No package is finalized on Devnet yet. The marketplace will only list commitment-backed sales.</p>}</section>
      <p className="meta" style={{ marginTop: 22 }}>{notice}</p>
    </main>
  </div>;
}
