/**
 * Demo mode: an in-browser stand-in for the `/api/v1` public and wallet
 * surface.
 *
 * Two reasons it exists:
 *  - `/api/v1` is only mounted when QARAU_RUNTIME_MODE=integrated, so a plain
 *    `npm run dev` leaves every public and wallet route returning 404.
 *  - Bidding, claiming and refunding otherwise require a funded Devnet wallet.
 *    In demo mode nothing is ever signed and sent, so no lamports move.
 *
 * The wallet still connects and still signs a *message* (free, no transaction)
 * so the connection path being demonstrated is the real one.
 */

import { demoAddress, demoDataset, demoPackages, demoSignature, type DemoPackage } from "./fixtures";

const STORAGE_KEY = "qarau.demo.state.v1";
const FLAG_KEY = "qarau.demo.enabled";

/**
 * Mirrors server/domain/access-round-state.mjs: terminal states are
 * authoritative, temporal ones are re-derived from the round window.
 */
const TEMPORAL_STATES = new Set(["upcoming", "live", "ended"]);
const TERMINAL_STATES = new Set(["settled", "access_granted", "expired"]);

function effectiveState(round: { state: string; opens_at: string; closes_at: string }) {
  if (TERMINAL_STATES.has(round.state) || !TEMPORAL_STATES.has(round.state)) return round.state;
  const opens = Date.parse(round.opens_at);
  const closes = Date.parse(round.closes_at);
  const now = Date.now();
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens) return round.state;
  if (now < opens) return "upcoming";
  if (now <= closes) return "live";
  return "ended";
}

type DemoBid = {
  package_id: string;
  round_pda: string;
  amount_lamports: number;
  tier: string;
  status: "placed" | "won" | "claimed" | "refunded";
  placed_at: string;
  transaction_signature: string;
};

type DemoEntitlement = {
  entitlement_pda: string;
  package_id: string;
  round_pda: string;
  tier: string;
  granted_at: string;
  expires_at: string;
};

type DemoState = {
  wallet: string | null;
  bids: DemoBid[];
  entitlements: DemoEntitlement[];
  /** Round PDA → epoch ms at which the demo auction closes and ranks bids. */
  settleAt: Record<string, number>;
};

/** How long a demo round runs after a bid lands, so settlement is watchable. */
const DEMO_SETTLE_MS = 30_000;

const HOUR = 3_600_000;

let active = false;

/**
 * Demo mode prefers the real catalog over the built-in fixtures: the same
 * research the public API publishes, with every access round forced into an
 * open window so all of them are biddable. Bidding still never touches the
 * chain, so an open round costs nothing. The fixtures are the fallback for
 * when `/api/v1` is not mounted at all.
 */
function adoptLive(row: Record<string, unknown>): DemoPackage {
  const round = (row.access_round ?? {}) as Record<string, unknown>;
  return {
    ...(row as unknown as DemoPackage),
    access_round: {
      ...(round as unknown as DemoPackage["access_round"]),
      state: "live",
      opens_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      closes_at: new Date(Date.now() + 72 * HOUR).toISOString(),
      minimum_bid_lamports: Number(round.minimum_bid_lamports ?? 1_000_000),
      max_winners: Number(round.max_winners ?? 5),
      bid_count: Number(round.bid_count ?? 0),
      winners_count: Number(round.winners_count ?? 0),
      clearing_price_lamports: round.clearing_price_lamports == null ? null : Number(round.clearing_price_lamports),
      settlement_rule: String(round.settlement_rule ?? "pay_as_bid_top_n"),
    },
  };
}

// Every round the demo serves is open, fixtures included.
let packages = demoPackages().map((item) => adoptLive(item as unknown as Record<string, unknown>));

/**
 * Memoized on the promise, not on a boolean: a flag set before the await lets
 * a concurrent caller (authentication racing the catalog fetch) read the
 * fixtures back while the real catalog is still in flight, and then seed a
 * wallet against rounds that are not the ones on screen.
 */
let catalogRequest: Promise<DemoPackage[]> | null = null;
function loadCatalog() { return (catalogRequest ??= fetchCatalog()); }

async function fetchCatalog() {
  // The default experience is deliberately self-contained. Do not probe an
  // unmounted integrated API first: its expected 404 polluted the reviewer
  // console and made a working demo look broken.
  if (active) return packages;
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}/api/v1/opportunities`, { credentials: "include" });
    if (!response.ok) return packages;
    const body = (await response.json()) as { packages?: Array<Record<string, unknown>> };
    const rows = (body.packages ?? []).filter((row) => row?.access_round && row.access_round_address);
    if (rows.length) packages = rows.map(adoptLive);
  } catch {
    // The integrated runtime is not up; the built-in fixtures stand in.
  }
  return packages;
}

function readFlag(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private-mode browsers throw on storage access; demo mode still works,
    // it just forgets bids between reloads.
    return null;
  }
}

function writeFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage is optional */
  }
}

/** Forced on by ?demo=1 / VITE_DEMO_MODE=on, forced off by ?demo=0 / =off. */
function forcedPreference(): boolean | null {
  const query = new URLSearchParams(window.location.search).get("demo");
  if (query === "1" || query === "on" || query === "true") {
    writeFlag(FLAG_KEY, "on");
    return true;
  }
  if (query === "0" || query === "off" || query === "false") {
    writeFlag(FLAG_KEY, "off");
    return false;
  }
  const stored = readFlag(FLAG_KEY);
  if (stored === "on") return true;
  if (stored === "off") return false;
  const configured = import.meta.env.VITE_DEMO_MODE;
  if (configured === "on") return true;
  if (configured === "off") return false;
  // Demo is the default: the published Devnet rounds this build points at have
  // no live on-chain accounts, so real bidding cannot complete, and a real bid
  // would cost SOL. `?demo=0` opts back into the chain-backed path.
  return true;
}

const preference = typeof window === "undefined" ? null : forcedPreference();
if (preference === true) active = true;

export function isDemoActive() {
  return active;
}

/** Stable, clearly synthetic public key used only by the browser fixture. */
export const demoWalletAddress = demoAddress("demo-bidder");

/** Latched the first time a real `/api/v1` call proves the runtime is absent. */
export function activateDemo() {
  if (preference === false || active) return active;
  active = true;
  return active;
}

function loadState(): DemoState {
  const raw = readFlag(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed && Array.isArray(parsed.bids)) return { ...parsed, settleAt: parsed.settleAt ?? {} };
    } catch {
      /* corrupt state falls through to a fresh one */
    }
  }
  return { wallet: null, bids: [], entitlements: [], settleAt: {} };
}

let state: DemoState = typeof window === "undefined" ? { wallet: null, bids: [], entitlements: [], settleAt: {} } : loadState();

function persist() {
  writeFlag(STORAGE_KEY, JSON.stringify(state));
}

/**
 * The demo auction actually runs: placing a bid arms a short countdown, after
 * which the round ranks its bids and becomes claimable. Without this a round
 * stayed `live` forever and the buyer never reached the delivered research.
 */
function roundState(item: DemoPackage) {
  const claimed = state.entitlements.some((entry) => entry.round_pda === item.access_round_address);
  if (claimed) return "access_granted";
  const settleAt = state.settleAt[item.access_round_address];
  if (settleAt && Date.now() >= settleAt) return "settled";
  if (settleAt) return "live";
  return effectiveState(item.access_round);
}

export function demoSettlesAt(roundPda: string) {
  return state.settleAt[roundPda] ?? null;
}

function packageByRound(roundPda: string) {
  const item = packages.find((entry) => entry.access_round_address === roundPda);
  if (!item) throw new Error("access_round_not_found");
  return item;
}

/**
 * A new demo identity deliberately starts clean so the reviewer can complete
 * the entire bid → settle → claim path themselves.
 */
function seedWallet(address: string) {
  if (state.wallet === address && state.bids.length) return;
  state = {
    wallet: address,
    bids: [],
    entitlements: [],
    settleAt: {},
  };
  persist();
}

/**
 * Bid counts are derived rather than incremented: the fixture count is the
 * crowd, plus this wallet's own live bid. Mutating the fixture instead made
 * the count depend on session history, so it silently reset on reload while
 * the persisted bid stayed.
 */
function publicView(item: DemoPackage) {
  const own = state.bids.some((bid) => bid.round_pda === item.access_round_address && bid.status !== "refunded") ? 1 : 0;
  const current = roundState(item);
  const ranked = current === "settled" || current === "access_granted";
  const ownBid = state.bids.find((bid) => bid.round_pda === item.access_round_address);
  return {
    ...item,
    access_round: {
      ...item.access_round,
      state: current,
      bid_count: item.access_round.bid_count + own,
      winners_count: ranked ? Math.min(item.access_round.max_winners, item.access_round.bid_count + own) : item.access_round.winners_count,
      clearing_price_lamports: ranked ? (ownBid?.amount_lamports ?? item.access_round.minimum_bid_lamports) : item.access_round.clearing_price_lamports,
    },
  };
}

/** Bid amount and tier are captured here and applied on confirm, mirroring
 * the real two-call flow (build transaction, then confirm the signature). */
const pendingBids = new Map<string, { tier: string; amount_lamports: number }>();

export const demoV1 = {
  opportunities: async () => {
    await loadCatalog();
    return { packages: packages.map(publicView) as unknown as Array<Record<string, unknown>> };
  },

  opportunity: async (packageId: string) => {
    await loadCatalog();
    const item = packages.find((entry) => entry.package_id === packageId);
    if (!item) throw new Error("package_not_found");
    return { package: publicView(item) as unknown as Record<string, unknown> };
  },

  proof: async (packageId: string) => {
    const item = packages.find((entry) => entry.package_id === packageId);
    if (!item) throw new Error("package_not_found");
    return {
      package_id: item.package_id,
      network: "devnet",
      program_id: "63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw",
      dataset_commitment: item.commitment_address,
      access_round: item.access_round_address,
      normalized_dataset_hash: demoAddress("normalized:" + item.package_id),
      manifest_hash: demoAddress("manifest:" + item.package_id),
      result_hash: demoAddress("result:" + item.package_id),
      access_policy_hash: demoAddress("policy:" + item.package_id),
      demo: true,
    } as Record<string, unknown>;
  },

  siwsChallenge: async (address: string) => {
    const nonce = demoAddress("nonce:" + address + ":" + Math.floor(Date.now() / 60_000)).slice(0, 24);
    return {
      nonce,
      message:
        "qarau.demo wants you to sign in with your Solana account:\n" +
        address +
        "\n\nDemo mode: this signature proves wallet ownership only. No transaction is created and no SOL is spent.\n\nURI: " +
        window.location.origin +
        "\nVersion: 1\nChain ID: solana:devnet\nNonce: " +
        nonce,
    };
  },

  siwsVerify: async (input: { address: string; nonce: string; signature: string }) => {
    await loadCatalog();
    seedWallet(input.address);
    return { wallet: input.address, expires_at: new Date(Date.now() + 3_600_000).toISOString() };
  },

  walletSession: async () => {
    if (!state.wallet) throw new Error("wallet_unauthorized");
    return {
      wallet: state.wallet,
      idle_expires_at: new Date(Date.now() + 1_800_000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    };
  },

  bidTransaction: async (roundPda: string, tier: "exclusive_early" | "delayed", amountLamports: number) => {
    await loadCatalog();
    const item = packageByRound(roundPda);
    if (effectiveState(item.access_round) !== "live") throw new Error("access_round_not_open");
    // NaN fails every comparison, so the minimum check alone would let it past.
    if (!Number.isSafeInteger(amountLamports) || amountLamports <= 0) throw new Error("invalid_bid_amount");
    if (amountLamports < item.access_round.minimum_bid_lamports) throw new Error("bid_below_minimum");
    if (state.bids.some((bid) => bid.round_pda === roundPda)) throw new Error("bid_already_placed");
    pendingBids.set(roundPda, { tier, amount_lamports: amountLamports });
    // Deliberately not a transaction: demo mode never reaches the wallet's
    // signAndSendTransaction, so this value is only ever a marker.
    return { transaction_base64: "", bidPda: demoAddress("bid:" + roundPda + ":" + state.wallet) };
  },

  confirmBid: async (roundPda: string, transactionSignature: string) => {
    await loadCatalog();
    const item = packageByRound(roundPda);
    const pending = pendingBids.get(roundPda) ?? { tier: "exclusive_early", amount_lamports: item.access_round.minimum_bid_lamports };
    pendingBids.delete(roundPda);
    const existing = state.bids.find((bid) => bid.round_pda === roundPda);
    if (existing) throw new Error("bid_already_placed");
    if (!existing) {
      state.bids.unshift({
        package_id: item.package_id,
        round_pda: roundPda,
        amount_lamports: pending.amount_lamports,
        tier: pending.tier,
        status: "placed",
        placed_at: new Date().toISOString(),
        transaction_signature: transactionSignature,
      });
    }
    state.settleAt[roundPda] = Date.now() + DEMO_SETTLE_MS;
    persist();
    return { package_id: item.package_id, bid_pda: demoAddress("bid:" + roundPda + ":" + state.wallet), status: "placed" };
  },

  claimTransaction: async (roundPda: string) => {
    await loadCatalog();
    const item = packageByRound(roundPda);
    if (!["settled", "access_granted"].includes(roundState(item))) throw new Error("access_round_not_settled");
    const bid = state.bids.find((entry) => entry.round_pda === roundPda);
    if (!bid) throw new Error("bid_not_found");
    if (bid.status === "refunded") throw new Error("bid_already_refunded");
    return { transaction_base64: "", entitlementPda: demoAddress("entitlement:" + state.wallet + ":" + item.package_id) };
  },

  confirmEntitlement: async (roundPda: string, transactionSignature: string) => {
    await loadCatalog();
    const item = packageByRound(roundPda);
    const bid = state.bids.find((entry) => entry.round_pda === roundPda);
    if (!bid) throw new Error("bid_not_found");
    // Rank against this round's own demo settlement, not the clearing price the
    // package carried in from the real catalog — that price belongs to a round
    // this demo never ran, and it wrongly rejected every claim.
    if (bid.amount_lamports < item.access_round.minimum_bid_lamports) throw new Error("wallet_not_in_top_n");
    bid.status = "claimed";
    const entitlementPda = demoAddress("entitlement:" + state.wallet + ":" + item.package_id);
    if (!state.entitlements.some((entry) => entry.entitlement_pda === entitlementPda)) {
      state.entitlements.unshift({
        entitlement_pda: entitlementPda,
        package_id: item.package_id,
        round_pda: roundPda,
        tier: bid.tier,
        granted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    }
    persist();
    void transactionSignature;
    return { package_id: item.package_id, entitlement_pda: entitlementPda, status: "granted" };
  },

  refundTransaction: async (roundPda: string) => {
    await loadCatalog();
    packageByRound(roundPda);
    const bid = state.bids.find((entry) => entry.round_pda === roundPda);
    if (!bid) throw new Error("bid_not_found");
    if (bid.status === "claimed") throw new Error("bid_already_claimed");
    bid.status = "refunded";
    delete state.settleAt[roundPda];
    persist();
    return { transaction_base64: "" };
  },

  accessEntitlements: async () => ({ entitlements: state.entitlements as unknown as Array<Record<string, unknown>> }),

  /** The delivered research itself — only readable once this wallet holds an entitlement. */
  dataset: async (packageId: string) => {
    await loadCatalog();
    const entitlement = state.entitlements.find((entry) => entry.package_id === packageId);
    if (!entitlement) throw new Error("entitlement_access_denied");
    const item = packages.find((entry) => entry.package_id === packageId);
    if (!item) throw new Error("package_not_found");
    return demoDataset(packageId, item.title, item.commitment_address, entitlement.entitlement_pda) as unknown as Record<string, unknown>;
  },

  auctionPositions: async () => {
    await loadCatalog();
    return {
    positions: state.bids.map((bid) => {
      const item = packages.find((entry) => entry.access_round_address === bid.round_pda);
      return {
        package_id: bid.package_id,
        round_pda: bid.round_pda,
        round_state: item ? roundState(item) : "settled",
        amount_lamports: bid.amount_lamports,
        tier: bid.tier,
        status: bid.status,
        placed_at: bid.placed_at,
        max_winners: item?.access_round.max_winners ?? 0,
        winners_count: item?.access_round.winners_count ?? 0,
        public_metadata: { title: item?.title ?? "Research access round" },
      };
    }) as unknown as Array<Record<string, unknown>>,
    };
  },
};

/** Called instead of signAndSendTransaction so the wallet is never asked to spend. */
export function demoTransactionSignature(kind: string) {
  return demoSignature(kind + ":" + state.wallet + ":" + Date.now());
}

export function resetDemoState() {
  state = { wallet: null, bids: [], entitlements: [], settleAt: {} };
  persist();
}
