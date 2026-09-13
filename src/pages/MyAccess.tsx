/* oxlint-disable react(set-state-in-effect) -- API polling deliberately mirrors external state. */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getWallets } from "@wallet-standard/app";
import { SolanaSignAndSendTransaction, SolanaSignMessage } from "@solana/wallet-standard-features";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { ApiError, demoSettlesAt, demoTransactionSignature, demoWalletAddress, isDemoActive, v1 } from "../api/client";
import type { Opportunity } from "./Opportunities";
import { PublicNav } from "../components/PublicNav";
import { DeliveredResearch, type Delivered } from "../components/DeliveredResearch";

type Connected = { mode: "wallet"; wallet: Wallet; account: WalletAccount; address: string } | { mode: "demo"; address: string };
type ConnectOutput = readonly WalletAccount[] | { accounts: readonly WalletAccount[] };
type ConnectFeature = { connect: () => Promise<ConnectOutput> };
type DisconnectFeature = { disconnect: () => Promise<void> };
type MessageFeature = { signMessage: (input: { account: WalletAccount; message: Uint8Array }) => Promise<readonly { signature: Uint8Array }[]> };
type SendFeature = { signAndSendTransaction: (input: { account: WalletAccount; transaction: Uint8Array; chain: "solana:devnet"; options: { commitment: "finalized" } }) => Promise<readonly { signature: Uint8Array }[]> };
type Position = { package_id: string; round_pda: string; round_state: string; amount_lamports: number; tier: string; status: string; public_metadata?: { title?: string } };

function base64ToBytes(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
function base64(bytes: Uint8Array) { let value = ""; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); }
function base58(bytes: Uint8Array) { const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const digits = [0]; for (const byte of bytes) { let carry = byte; for (let index = 0; index < digits.length; index += 1) { carry += digits[index] << 8; digits[index] = carry % 58; carry = Math.floor(carry / 58); } while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); } } let result = ""; for (const byte of bytes) { if (byte !== 0) break; result += "1"; } for (let index = digits.length - 1; index >= 0; index -= 1) result += alphabet[digits[index]]; return result; }
function short(value: string) { return `${value.slice(0, 5)}…${value.slice(-5)}`; }
function lamports(value: number) { return `${value.toLocaleString("en-US")} lamports`; }
function sol(value: number) { return `${(value / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL`; }
// Bid inputs are grouped for reading ("25,000,000 lamports") but must be sent
// as a plain integer, so anything that is not a digit is dropped as it is typed.
function digitsOnly(value: string) { return value.replace(/\D/g, ""); }

/** Both the demo layer and /api/v1 answer with machine codes; these are the ones a bidder can actually cause. */
const ERROR_TEXT: Record<string, string> = {
  wallet_unauthorized: "Your wallet session expired. Connect the wallet again.",
  auction_not_active: "The on-chain round is not open for bids right now.",
  solana_rpc_unavailable: "Devnet could not read this round's on-chain account.",
  access_round_not_open: "This round is not open for bids.",
  access_round_not_found: "That access round is not published on Devnet.",
  access_round_not_settled: "This round has not settled yet.",
  bid_below_minimum: "That bid is below the round minimum.",
  invalid_bid_amount: "Enter the bid as a whole number of lamports.",
  invalid_bid_tier: "That access tier is not supported.",
  bid_tier_not_enabled: "This round does not accept the selected access tier.",
  bid_not_found: "No bid from this wallet on that round.",
  bid_already_placed: "A bid from this wallet already exists for this round. Wait for settlement, then claim or refund it.",
  bid_already_claimed: "That entitlement was already claimed.",
  bid_already_refunded: "That bid was already refunded.",
  wallet_not_in_top_n: "Only a Top-N winner can claim access.",
  winning_bid_not_refundable: "A winning bid cannot be refunded — claim it instead.",
  transaction_not_finalized: "The transaction has not finalized on Devnet yet.",
  entitlement_access_denied: "This wallet holds no entitlement for that package.",
  package_not_found: "That research package is no longer published.",
};
/**
 * An unmapped code is appended rather than dropped: reporting a failure
 * without its reason leaves nothing to act on.
 */
function explain(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (ERROR_TEXT[message]) return ERROR_TEXT[message];
  if (!message) return fallback;
  return /^[a-z0-9_]+$/.test(message) ? `${fallback.replace(/\.$/, "")} (${message}).` : message;
}

function isDelivered(value: unknown): value is Delivered {
  const candidate = value as Delivered | null;
  return Boolean(candidate && Array.isArray(candidate.columns) && Array.isArray(candidate.rows) && candidate.rows.length && candidate.proof && candidate.summary);
}

// Phantom and several other wallets advertise `solana:mainnet` on the wallet
// and on freshly connected accounts even when they are pointed at Devnet, so
// filtering on `solana:devnet` alone hid them from the connect list entirely.
function isSolanaWallet(wallet: Wallet) { return wallet.chains.some((chain) => chain.startsWith("solana:")) && "standard:connect" in wallet.features && SolanaSignMessage in wallet.features; }
function compatibleWallets() { return getWallets().get().filter(isSolanaWallet); }
function pickAccount(accounts: readonly WalletAccount[]) { return accounts.find((account) => account.chains.includes("solana:devnet")) ?? accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:"))) ?? accounts[0]; }

export function MyAccessPage() {
  const [searchParams] = useSearchParams();
  const [wallets, setWallets] = useState<readonly Wallet[]>(compatibleWallets);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [entitlements, setEntitlements] = useState<Array<Record<string, unknown>>>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [tier, setTier] = useState<"exclusive_early" | "delayed">("exclusive_early");
  const [demo, setDemo] = useState(isDemoActive());
  const [notice, setNotice] = useState("Connect your existing Devnet wallet. QARAU never creates or stores a wallet for you.");
  const [delivered, setDelivered] = useState<Delivered[]>([]);
  const [clock, setClock] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const dashboardRef = useRef<HTMLElement>(null);

  // The dashboard is the payoff of the whole round, so it opens itself the
  // moment the first entitlement lands rather than waiting to be scrolled to.
  const deliveredCount = delivered.length;
  useEffect(() => {
    if (deliveredCount === 0) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dashboardRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [deliveredCount]);

  // A lapsed SIWS session must drop the connection, or the bid button stays
  // enabled and every press fails the same way.
  const fail = (error: unknown, fallback: string) => { if (error instanceof ApiError && error.status === 401) { setConnected(null); setPositions([]); setEntitlements([]); } setNotice(explain(error, fallback)); };
  const settlingIn = (position: Position) => { const at = demoSettlesAt(position.round_pda); return at === null || at <= clock ? null : Math.ceil((at - clock) / 1000); };
  const existingBid = (item: Opportunity) => positions.find((position) => position.round_pda === item.access_round_address && position.status !== "refunded");
  const bidAmount = (item: Opportunity) => { const typed = amounts[item.package_id]; return typed === undefined || typed === "" ? item.access_round.minimum_bid_lamports : Number(typed); };
  const selectedRound = searchParams.get("round");
  const visibleOpportunities = selectedRound ? opportunities.filter((item) => item.access_round_address === selectedRound) : opportunities;
  const refreshPublic = () => v1.opportunities().then((data) => { setOpportunities(data.packages as unknown as Opportunity[]); setDemo(isDemoActive()); }).catch(() => setNotice("Public research is temporarily unavailable."));
  const refreshPrivate = async () => {
    const [positionData, accessData] = await Promise.all([v1.auctionPositions(), v1.accessEntitlements()]);
    setPositions(positionData.positions as unknown as Position[]);
    setEntitlements(accessData.entitlements);
    // An entitlement is only worth anything if the research behind it is readable.
    const ids = [...new Set(accessData.entitlements.map((entry) => String((entry as { package_id?: string }).package_id ?? "")))].filter(Boolean);
    const datasets = await Promise.all(ids.map((id) => v1.datasetView(id).catch(() => null)));
    setDelivered(datasets.filter(isDelivered));
  };
  // This effect owns the public polling lifecycle; the setters intentionally mirror external API state.
  // oxlint-disable-next-line react(set-state-in-effect)
  useEffect(() => { refreshPublic(); const timer = window.setInterval(refreshPublic, 5_000); return () => window.clearInterval(timer); }, []);
  // A running round has to visibly progress. The clock tick is local and cheap;
  // the wallet view is re-read only on the tick where a deadline actually
  // elapses, rather than every second.
  useEffect(() => {
    if (!connected) return;
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const elapsed = positions.some((position) => { const at = demoSettlesAt(position.round_pda); return at !== null && at > previous && at <= now; });
      previous = now;
      setClock(now);
      if (elapsed) void refreshPrivate().catch(() => {});
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [connected, positions]);
  // Wallet extensions register through the Wallet Standard whenever their
  // content script finishes injecting, which is routinely after React mounts.
  // Without these listeners Phantom simply never appeared in the list.
  useEffect(() => {
    const registry = getWallets();
    const sync = () => setWallets(compatibleWallets());
    const off = [registry.on("register", sync), registry.on("unregister", sync)];
    return () => { for (const remove of off) remove(); };
  }, []);

  const authenticate = async (wallet: Wallet, account: WalletAccount) => { const signing = wallet.features[SolanaSignMessage] as MessageFeature | undefined; if (!signing) throw new Error("Wallet cannot sign messages."); const challenge = await v1.siwsChallenge(account.address); const signed = await signing.signMessage({ account, message: new TextEncoder().encode(challenge.message) }); if (!signed[0]?.signature) throw new Error("Wallet returned no signature."); await v1.siwsVerify({ address: account.address, nonce: challenge.nonce, signature: base64(signed[0].signature) }); setConnected({ mode: "wallet", wallet, account, address: account.address }); setDemo(isDemoActive()); await refreshPrivate(); setNotice(`Authenticated as ${short(account.address)}.${isDemoActive() ? " Demo mode: signing a message costs nothing." : ""}`); };
  const connectDemo = async () => { try { setBusy(true); await v1.siwsVerify({ address: demoWalletAddress, nonce: "demo", signature: "demo" }); setConnected({ mode: "demo", address: demoWalletAddress }); await refreshPrivate(); setNotice("Demo bidder connected. No wallet extension, signature, or SOL is required."); } catch (error) { fail(error, "Demo connection failed."); } finally { setBusy(false); } };
  const connect = async (wallet: Wallet) => { try { setBusy(true); setNotice(`Approve the connection in ${wallet.name}…`); const feature = wallet.features["standard:connect"] as ConnectFeature | undefined; if (!feature) throw new Error("Wallet cannot connect."); const output = await feature.connect(); const accounts = Array.isArray(output) ? output : (output as { accounts: readonly WalletAccount[] }).accounts; if (!accounts?.length) throw new Error(`${wallet.name} returned no accounts. Unlock it and try again.`); const account = pickAccount(accounts); if (!account) throw new Error("No Solana account found in this wallet."); await authenticate(wallet, account); } catch (error) { fail(error, "Wallet connection failed."); } finally { setBusy(false); } };
  const disconnect = async () => { const feature = connected?.mode === "wallet" ? connected.wallet.features["standard:disconnect"] as DisconnectFeature | undefined : undefined; try { await feature?.disconnect(); } catch { /* the wallet may already be disconnected */ } setConnected(null); setPositions([]); setEntitlements([]); setNotice("Wallet disconnected."); };
  // In demo mode nothing is ever signed and sent, so no lamports leave the
  // wallet — the returned signature is a local placeholder.
  const send = async (transactionBase64: string, kind: string) => { if (!connected) throw new Error("Connect a wallet first."); if (connected.mode === "demo") return demoTransactionSignature(kind); const sender = connected.wallet.features[SolanaSignAndSendTransaction] as SendFeature | undefined; if (!sender) throw new Error("Wallet cannot send transactions."); const sent = await sender.signAndSendTransaction({ account: connected.account, transaction: base64ToBytes(transactionBase64), chain: "solana:devnet", options: { commitment: "finalized" } }); if (!sent[0]?.signature) throw new Error("Wallet returned no transaction signature."); return base58(sent[0].signature); };
  const bid = async (item: Opportunity) => {
    const minimum = item.access_round.minimum_bid_lamports;
    const amount = bidAmount(item);
    // Number("") is 0 and Number("abc") is NaN, and NaN fails every `<`
    // comparison — so an unvalidated amount used to sail through the minimum
    // check and get recorded as a NaN bid.
    if (!Number.isSafeInteger(amount) || amount <= 0) { setNotice("Enter the bid as a whole number of lamports."); return; }
    if (amount < minimum) { setNotice(`Minimum bid for this round is ${lamports(minimum)} (${sol(minimum)}).`); return; }
    if (existingBid(item)) { setNotice("This wallet already has one irreversible bid in this round."); return; }
    try { setBusy(true); setNotice(isDemoActive() ? "Simulating the escrowed bid — no SOL is spent…" : "Review and sign the escrowed bid in your wallet…"); const unsigned = await v1.bidTransaction(item.access_round_address, tier, amount); const signature = await send(unsigned.transaction_base64, "bid"); await v1.confirmBid(item.access_round_address, signature); setClock(() => Date.now()); await Promise.all([refreshPrivate(), refreshPublic()]); setNotice(`Bid placed at ${lamports(amount)} (${sol(amount)})${isDemoActive() ? " in demo mode" : " on Devnet"}. Ranking is deterministic: amount, then time, then wallet address.`); } catch (error) { fail(error, "Bid failed."); } finally { setBusy(false); } };
  const claim = async (roundPda: string) => { try { setBusy(true); setNotice(isDemoActive() ? "Simulating the entitlement claim…" : "Review the entitlement claim in your wallet…"); const unsigned = await v1.claimTransaction(roundPda); const signature = await send(unsigned.transaction_base64, "claim"); const result = await v1.confirmEntitlement(roundPda, signature); await refreshPrivate(); setNotice(`Access finalized as ${short(result.entitlement_pda)}.`); } catch (error) { fail(error, "Claim failed."); } finally { setBusy(false); } };
  const refund = async (roundPda: string) => { try { setBusy(true); setNotice(isDemoActive() ? "Simulating the losing-bid refund…" : "Review the full losing-bid refund in your wallet…"); const unsigned = await v1.refundTransaction(roundPda); await send(unsigned.transaction_base64, "refund"); await refreshPrivate(); setNotice(isDemoActive() ? "Refund recorded in demo mode." : "Refund transaction finalized on Devnet."); } catch (error) { fail(error, "Refund failed."); } finally { setBusy(false); } };

  return <div className="public-research"><PublicNav /><main className="shell market-main">
    <section className="market-hero"><p className="meta">Existing wallet / Devnet{demo ? " / demo mode" : ""}</p><h1 className="display-sm">Bid for access. Claim only if you finish Top-N.</h1><p className="body market-lead">{demo ? "Demo mode is active: the access rounds below are local fixtures, and bidding, claiming and refunding are simulated in the browser. Your wallet is asked for a message signature only — it never signs a transaction and no lamports are spent." : "Your wallet signs every action. A bid is held by the program until settlement; winners claim a time-limited entitlement and non-winners recover the full bid."}</p></section>
    <section className="market-state"><div><p className="meta">01 / Authenticate</p><h2 className="h2">{connected ? `Connected / ${short(connected.address)}` : demo ? "Try the complete demo" : wallets.length ? "Choose an existing wallet" : "No compatible wallet detected"}</h2></div><div><p className="body-sm">{demo ? "Use the synthetic demo bidder to complete the full auction without installing a wallet or spending SOL. You can still connect a real Devnet wallet when demo mode is off." : wallets.length || connected ? "A message signature creates a wallet session. It costs no SOL and exposes no secret key." : "Install Phantom (or another Wallet Standard wallet), unlock it, then reload this page."}</p><div className="source-actions" style={{ marginTop: 18 }}>{!connected && demo && <button className="btn btn-primary" disabled={busy} onClick={connectDemo}>Continue as demo bidder</button>}{!connected && wallets.map((wallet) => <button className="btn btn-secondary" disabled={busy} key={wallet.name} onClick={() => connect(wallet)}>Connect {wallet.name}</button>)}{connected && <button className="btn btn-secondary" disabled={busy} onClick={disconnect}>Disconnect</button>}</div></div></section>
    <section className="market-state"><div><p className="meta">02 / Active rounds</p><h2 className="h2">{selectedRound ? "Selected access round" : "Validated research"}</h2><div className="source-actions" style={{ marginTop: 18 }}><button className={`opt ${tier === "exclusive_early" ? "is-active" : ""}`} onClick={() => setTier("exclusive_early")}>Early</button><button className={`opt ${tier === "delayed" ? "is-active" : ""}`} onClick={() => setTier("delayed")}>Delayed</button></div></div><div>{visibleOpportunities.map((item) => { const current = existingBid(item); const amount = bidAmount(item); const valid = Number.isSafeInteger(amount) && amount >= item.access_round.minimum_bid_lamports; return <article className="market-package" key={item.package_id}><p className="meta">{item.access_round.state.toUpperCase()} / Top {item.access_round.max_winners} / {item.access_round.bid_count} bids</p><h2 className="h2">{item.title}</h2><p className="body-sm">Minimum {lamports(item.access_round.minimum_bid_lamports)} ({sol(item.access_round.minimum_bid_lamports)}) · closes {new Date(item.access_round.closes_at).toLocaleString()}</p>{item.access_round.state === "live" && <><div className="source-actions" style={{ marginTop: 16 }}><span className="bid-field"><input className="input" disabled={Boolean(current)} inputMode="numeric" autoComplete="off" spellCheck={false} placeholder={String(item.access_round.minimum_bid_lamports)} aria-label={`Bid for ${item.title}, in lamports`} value={amounts[item.package_id] ?? String(item.access_round.minimum_bid_lamports)} onChange={(event) => setAmounts((currentAmounts) => ({ ...currentAmounts, [item.package_id]: digitsOnly(event.target.value) }))} onKeyDown={(event) => { if (event.key === "Enter" && valid && connected && !busy && !current) bid(item); }} /><span className="bid-field-unit">lamports</span></span><button className="btn btn-primary" disabled={!connected || busy || !valid || Boolean(current)} onClick={() => bid(item)}>{current ? "Bid placed" : "Place bid"}</button></div><p className="body-sm" style={{ marginTop: 10 }}>{current ? `Your bid of ${lamports(Number(current.amount_lamports))} is held until settlement.` : !valid ? `Enter at least ${lamports(item.access_round.minimum_bid_lamports)}.` : `Bidding ${sol(amount)}.`}</p></>}</article>; })}{!visibleOpportunities.length && <p className="body-sm">No commitment-backed access round matches this link.</p>}</div></section>
    {connected && <section className="market-state"><div><p className="meta">03 / My positions</p><h2 className="h2">Bids and access</h2><p className="body-sm">{entitlements.length} active entitlement{entitlements.length === 1 ? "" : "s"}.</p></div><div>{positions.map((position) => <article className="market-package" key={`${position.round_pda}-${position.package_id}`}><p className="meta">{position.status.toUpperCase()} / {position.round_state.toUpperCase()}</p><h2 className="h2">{position.public_metadata?.title ?? "Research access round"}</h2><p className="body-sm">{lamports(Number(position.amount_lamports))} ({sol(Number(position.amount_lamports))}) · {position.tier.replaceAll("_", " ")}</p>{settlingIn(position) !== null && <p className="meta" style={{ marginTop: 8 }}>Round closes and ranks bids in {settlingIn(position)}s</p>}{["settled", "access_granted"].includes(position.round_state) && position.status !== "claimed" && position.status !== "refunded" && <div className="source-actions" style={{ marginTop: 16 }}><button className="btn btn-primary" disabled={busy} onClick={() => claim(position.round_pda)}>Claim if Top-N</button><button className="btn btn-secondary" disabled={busy} onClick={() => refund(position.round_pda)}>Refund if below Top-N</button></div>}</article>)}{!positions.length && <p className="body-sm">No bids from this wallet yet.</p>}</div></section>}
    {connected && delivered.length > 0 && <section className="market-state" ref={dashboardRef}><div><p className="meta">04 / Delivered research</p><h2 className="h2">Your data</h2><p className="body-sm">Readable only while this wallet holds a valid entitlement.</p></div><div>{delivered.map((item) => <DeliveredResearch item={item} key={item.package_id} />)}</div></section>}
    <p className="meta" role="status" style={{ marginTop: 22 }}>{notice}</p>
  </main></div>;
}
