#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

pub mod contracts;

declare_id!("63VZwKUPcWqo2JwpQHLxT4HHgQsMREpERZg3DpfSnnMw");

pub const TIER_EXCLUSIVE_EARLY: u8 = 1;
pub const TIER_DELAYED: u8 = 2;
pub const STATUS_ACTIVE: u8 = 1;
pub const STATUS_CLOSED: u8 = 2;
pub const PAYMENT_SOL: u8 = 0;
pub const AUCTION_STATUS_ACTIVE: u8 = 1;
pub const AUCTION_STATUS_SETTLED: u8 = 2;
pub const BID_STATUS_ACTIVE: u8 = 1;
pub const BID_STATUS_CLAIMED: u8 = 2;
pub const BID_STATUS_REFUNDED: u8 = 3;
pub const SETTLEMENT_TOP_N_PAY_AS_BID: u8 = 1;
pub const MAX_AUCTION_BIDS: usize = 32;

#[program]
pub mod qarau_registry {
    use super::*;

    /// Initializes a publisher-owned registry. Treasury is fixed here; a sale
    /// cannot redirect buyer SOL at purchase time.
    pub fn initialize(ctx: Context<Initialize>, treasury: Pubkey) -> Result<()> {
        require!(
            treasury != Pubkey::default(),
            RegistryError::InvalidTreasury
        );
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.treasury = treasury;
        registry.schema_version = 1;
        registry.paused = false;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.registry.paused = paused;
        Ok(())
    }

    /// Stores only immutable artifact hashes and controls, never source data.
    #[allow(clippy::too_many_arguments)]
    pub fn create_dataset_commitment(
        ctx: Context<CreateDatasetCommitment>,
        dataset_id_hash: [u8; 32],
        version: u32,
        raw_snapshot_hash: [u8; 32],
        normalized_dataset_hash: [u8; 32],
        analysis_manifest_hash: [u8; 32],
        analysis_result_hash: [u8; 32],
        access_policy_hash: [u8; 32],
        max_seats: u32,
        allowed_tier_mask: u8,
        delayed_version_lag: u32,
        delayed_release_seconds: i64,
        grant_duration_seconds: i64,
    ) -> Result<()> {
        require!(!ctx.accounts.registry.paused, RegistryError::RegistryPaused);
        validate_commitment(
            dataset_id_hash,
            version,
            raw_snapshot_hash,
            normalized_dataset_hash,
            analysis_manifest_hash,
            analysis_result_hash,
            access_policy_hash,
            max_seats,
            allowed_tier_mask,
            delayed_version_lag,
            delayed_release_seconds,
            grant_duration_seconds,
        )?;
        let account = &mut ctx.accounts.commitment;
        account.dataset_id_hash = dataset_id_hash;
        account.version = version;
        account.raw_snapshot_hash = raw_snapshot_hash;
        account.normalized_dataset_hash = normalized_dataset_hash;
        account.analysis_manifest_hash = analysis_manifest_hash;
        account.analysis_result_hash = analysis_result_hash;
        account.access_policy_hash = access_policy_hash;
        account.publisher = ctx.accounts.authority.key();
        account.created_at = Clock::get()?.unix_timestamp;
        account.max_seats = max_seats;
        account.allowed_tier_mask = allowed_tier_mask;
        account.delayed_version_lag = delayed_version_lag;
        account.delayed_release_seconds = delayed_release_seconds;
        account.grant_duration_seconds = grant_duration_seconds;
        account.status = STATUS_ACTIVE;
        account.bump = ctx.bumps.commitment;
        Ok(())
    }

    pub fn create_sale(
        ctx: Context<CreateSale>,
        starts_at: i64,
        ends_at: i64,
        early_price_lamports: u64,
        delayed_price_lamports: u64,
        enabled_tier_mask: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.registry.paused, RegistryError::RegistryPaused);
        require!(
            ctx.accounts.commitment.status == STATUS_ACTIVE,
            RegistryError::CommitmentInactive
        );
        require!(starts_at < ends_at, RegistryError::InvalidSaleWindow);
        require!(
            early_price_lamports > 0 && delayed_price_lamports > 0,
            RegistryError::InvalidPrice
        );
        require!(
            enabled_tier_mask > 0
                && enabled_tier_mask & !ctx.accounts.commitment.allowed_tier_mask == 0,
            RegistryError::InvalidTier
        );
        let sale = &mut ctx.accounts.sale;
        sale.dataset_commitment = ctx.accounts.commitment.key();
        sale.treasury = ctx.accounts.treasury.key();
        sale.starts_at = starts_at;
        sale.ends_at = ends_at;
        sale.payment_asset = PAYMENT_SOL;
        sale.early_price_lamports = early_price_lamports;
        sale.delayed_price_lamports = delayed_price_lamports;
        sale.grant_duration_seconds = ctx.accounts.commitment.grant_duration_seconds;
        sale.delayed_initial_commitment = ctx.accounts.commitment.key();
        sale.max_seats = ctx.accounts.commitment.max_seats;
        sale.occupied_seats = 0;
        sale.enabled_tier_mask = enabled_tier_mask;
        sale.status = STATUS_ACTIVE;
        sale.bump = ctx.bumps.sale;
        Ok(())
    }

    /// Atomically transfers SOL, enforces the on-chain cap, and mints access.
    pub fn purchase(ctx: Context<Purchase>, tier: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let sale = &mut ctx.accounts.sale;
        require!(sale.status == STATUS_ACTIVE, RegistryError::SaleInactive);
        require!(
            now >= sale.starts_at && now <= sale.ends_at,
            RegistryError::SaleNotOpen
        );
        require!(
            sale.payment_asset == PAYMENT_SOL,
            RegistryError::UnsupportedPaymentAsset
        );
        require!(
            tier == TIER_EXCLUSIVE_EARLY || tier == TIER_DELAYED,
            RegistryError::InvalidTier
        );
        require!(
            sale.enabled_tier_mask & tier != 0,
            RegistryError::TierUnavailable
        );
        require!(
            sale.occupied_seats < sale.max_seats,
            RegistryError::SeatsExhausted
        );
        let price = if tier == TIER_EXCLUSIVE_EARLY {
            sale.early_price_lamports
        } else {
            sale.delayed_price_lamports
        };
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            price,
        )?;
        sale.occupied_seats = sale
            .occupied_seats
            .checked_add(1)
            .ok_or(RegistryError::SeatOverflow)?;
        let grant = &mut ctx.accounts.access_grant;
        grant.dataset_commitment = ctx.accounts.commitment.key();
        grant.sale = sale.key();
        grant.buyer = ctx.accounts.buyer.key();
        grant.dataset_id_hash = ctx.accounts.commitment.dataset_id_hash;
        grant.purchased_version = ctx.accounts.commitment.version;
        grant.tier = tier;
        grant.granted_at = now;
        grant.expires_at = now
            .checked_add(sale.grant_duration_seconds)
            .ok_or(RegistryError::InvalidGrantDuration)?;
        grant.status = STATUS_ACTIVE;
        grant.bump = ctx.bumps.access_grant;
        Ok(())
    }

    pub fn close_sale(ctx: Context<CloseSale>) -> Result<()> {
        ctx.accounts.sale.status = STATUS_CLOSED;
        Ok(())
    }

    /// Opens a bounded Top-N pay-as-bid access round for one committed package.
    pub fn create_access_round(
        ctx: Context<CreateAccessRound>,
        opens_at: i64,
        closes_at: i64,
        minimum_bid_lamports: u64,
        max_winners: u32,
        enabled_tier_mask: u8,
    ) -> Result<()> {
        require!(!ctx.accounts.registry.paused, RegistryError::RegistryPaused);
        require!(
            ctx.accounts.commitment.status == STATUS_ACTIVE,
            RegistryError::CommitmentInactive
        );
        require!(opens_at < closes_at, RegistryError::InvalidAuctionWindow);
        require!(minimum_bid_lamports > 0, RegistryError::InvalidBidAmount);
        require!(
            max_winners > 0
                && max_winners <= ctx.accounts.commitment.max_seats
                && max_winners <= 10,
            RegistryError::InvalidWinnerCount
        );
        require!(
            enabled_tier_mask > 0
                && enabled_tier_mask & !ctx.accounts.commitment.allowed_tier_mask == 0,
            RegistryError::InvalidTier
        );
        let round = &mut ctx.accounts.access_round;
        round.dataset_commitment = ctx.accounts.commitment.key();
        round.treasury = ctx.accounts.treasury.key();
        round.opens_at = opens_at;
        round.closes_at = closes_at;
        round.minimum_bid_lamports = minimum_bid_lamports;
        round.max_winners = max_winners;
        round.bid_count = 0;
        round.winners_count = 0;
        round.claimed_count = 0;
        round.enabled_tier_mask = enabled_tier_mask;
        round.settlement_rule = SETTLEMENT_TOP_N_PAY_AS_BID;
        round.status = AUCTION_STATUS_ACTIVE;
        round.clearing_price_lamports = 0;
        round.bids = Vec::new();
        round.bump = ctx.bumps.access_round;
        Ok(())
    }

    /// Escrows one immutable bid and updates the on-chain sorted leaderboard.
    pub fn place_bid(ctx: Context<PlaceBid>, amount_lamports: u64, tier: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.access_round;
        require!(
            round.status == AUCTION_STATUS_ACTIVE,
            RegistryError::AuctionInactive
        );
        require!(
            now >= round.opens_at && now <= round.closes_at,
            RegistryError::AuctionNotOpen
        );
        require!(
            amount_lamports >= round.minimum_bid_lamports,
            RegistryError::InvalidBidAmount
        );
        require!(
            tier == TIER_EXCLUSIVE_EARLY || tier == TIER_DELAYED,
            RegistryError::InvalidTier
        );
        require!(
            round.enabled_tier_mask & tier != 0,
            RegistryError::TierUnavailable
        );
        require!(
            round.bids.len() < MAX_AUCTION_BIDS,
            RegistryError::AuctionBidCapacityReached
        );
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.bidder.to_account_info(),
                    to: ctx.accounts.bid.to_account_info(),
                },
            ),
            amount_lamports,
        )?;
        let bid = &mut ctx.accounts.bid;
        bid.access_round = round.key();
        bid.bidder = ctx.accounts.bidder.key();
        bid.amount_lamports = amount_lamports;
        bid.tier = tier;
        bid.placed_at = now;
        bid.status = BID_STATUS_ACTIVE;
        bid.bump = ctx.bumps.bid;
        round.bids.push(BidEntry {
            bidder: bid.bidder,
            amount_lamports,
            tier,
            placed_at: now,
        });
        rank_bid_entries(&mut round.bids);
        round.bid_count = u32::try_from(round.bids.len())
            .map_err(|_| RegistryError::AuctionBidCapacityReached)?;
        Ok(())
    }

    /// Freezes the Top-N result on-chain. No off-chain winner list is trusted.
    pub fn settle_access_round(ctx: Context<SettleAccessRound>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.access_round;
        require!(
            round.status == AUCTION_STATUS_ACTIVE,
            RegistryError::AuctionInactive
        );
        require!(now > round.closes_at, RegistryError::AuctionStillOpen);
        round.winners_count = winner_count(round.max_winners, round.bid_count);
        round.clearing_price_lamports = if round.winners_count == 0 {
            0
        } else {
            round.bids[(round.winners_count - 1) as usize].amount_lamports
        };
        round.status = AUCTION_STATUS_SETTLED;
        Ok(())
    }

    /// A Top-N bidder pays the escrowed bid and receives a load-bearing entitlement.
    pub fn claim_entitlement(ctx: Context<ClaimEntitlement>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.access_round;
        require!(
            round.status == AUCTION_STATUS_SETTLED,
            RegistryError::AuctionNotSettled
        );
        require!(
            ctx.accounts.bid.status == BID_STATUS_ACTIVE,
            RegistryError::BidInactive
        );
        let position = round
            .bids
            .iter()
            .position(|entry| entry.bidder == ctx.accounts.bidder.key())
            .ok_or(RegistryError::BidNotFound)?;
        require!(
            position < round.winners_count as usize,
            RegistryError::NotAuctionWinner
        );
        transfer_program_lamports(
            &ctx.accounts.bid.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            ctx.accounts.bid.amount_lamports,
        )?;
        ctx.accounts.bid.status = BID_STATUS_CLAIMED;
        round.claimed_count = round
            .claimed_count
            .checked_add(1)
            .ok_or(RegistryError::SeatOverflow)?;
        let entitlement = &mut ctx.accounts.entitlement;
        entitlement.dataset_commitment = ctx.accounts.commitment.key();
        entitlement.access_round = round.key();
        entitlement.wallet = ctx.accounts.bidder.key();
        entitlement.dataset_id_hash = ctx.accounts.commitment.dataset_id_hash;
        entitlement.purchased_version = ctx.accounts.commitment.version;
        entitlement.tier = ctx.accounts.bid.tier;
        entitlement.granted_at = now;
        entitlement.expires_at = now
            .checked_add(ctx.accounts.commitment.grant_duration_seconds)
            .ok_or(RegistryError::InvalidGrantDuration)?;
        entitlement.bid_amount_lamports = ctx.accounts.bid.amount_lamports;
        entitlement.status = STATUS_ACTIVE;
        entitlement.bump = ctx.bumps.entitlement;
        Ok(())
    }

    /// A non-winning bidder receives the full escrowed bid back; no entitlement exists.
    pub fn refund_losing_bid(ctx: Context<RefundLosingBid>) -> Result<()> {
        let round = &ctx.accounts.access_round;
        require!(
            round.status == AUCTION_STATUS_SETTLED,
            RegistryError::AuctionNotSettled
        );
        require!(
            ctx.accounts.bid.status == BID_STATUS_ACTIVE,
            RegistryError::BidInactive
        );
        let position = round
            .bids
            .iter()
            .position(|entry| entry.bidder == ctx.accounts.bidder.key())
            .ok_or(RegistryError::BidNotFound)?;
        require!(
            position >= round.winners_count as usize,
            RegistryError::AuctionWinnerCannotRefund
        );
        transfer_program_lamports(
            &ctx.accounts.bid.to_account_info(),
            &ctx.accounts.bidder.to_account_info(),
            ctx.accounts.bid.amount_lamports,
        )?;
        ctx.accounts.bid.status = BID_STATUS_REFUNDED;
        Ok(())
    }
}

fn transfer_program_lamports(
    from: &AccountInfo<'_>,
    to: &AccountInfo<'_>,
    amount: u64,
) -> Result<()> {
    let from_balance = from.lamports();
    let to_balance = to.lamports();
    **from.try_borrow_mut_lamports()? = from_balance
        .checked_sub(amount)
        .ok_or(RegistryError::InvalidBidEscrow)?;
    **to.try_borrow_mut_lamports()? = to_balance
        .checked_add(amount)
        .ok_or(RegistryError::InvalidBidEscrow)?;
    Ok(())
}

fn rank_bid_entries(entries: &mut [BidEntry]) {
    entries.sort_by(|left, right| {
        right
            .amount_lamports
            .cmp(&left.amount_lamports)
            .then_with(|| left.placed_at.cmp(&right.placed_at))
            .then_with(|| left.bidder.to_bytes().cmp(&right.bidder.to_bytes()))
    });
}

fn winner_count(max_winners: u32, bid_count: u32) -> u32 {
    max_winners.min(bid_count)
}

fn nonzero(value: [u8; 32]) -> bool {
    value != [0; 32]
}

#[allow(clippy::too_many_arguments)]
fn validate_commitment(
    dataset_id_hash: [u8; 32],
    version: u32,
    raw_snapshot_hash: [u8; 32],
    normalized_dataset_hash: [u8; 32],
    analysis_manifest_hash: [u8; 32],
    analysis_result_hash: [u8; 32],
    access_policy_hash: [u8; 32],
    max_seats: u32,
    allowed_tier_mask: u8,
    delayed_version_lag: u32,
    delayed_release_seconds: i64,
    grant_duration_seconds: i64,
) -> Result<()> {
    require!(
        nonzero(dataset_id_hash)
            && nonzero(raw_snapshot_hash)
            && nonzero(normalized_dataset_hash)
            && nonzero(analysis_manifest_hash)
            && nonzero(analysis_result_hash)
            && nonzero(access_policy_hash),
        RegistryError::EmptyHash
    );
    require!(version > 0, RegistryError::InvalidVersion);
    require!(max_seats > 0, RegistryError::InvalidSeatCount);
    require!(
        allowed_tier_mask > 0 && allowed_tier_mask & !3 == 0,
        RegistryError::InvalidTier
    );
    require!(
        delayed_version_lag > 0 && delayed_release_seconds >= 0,
        RegistryError::InvalidDelayedPolicy
    );
    require!(
        grant_duration_seconds > 0,
        RegistryError::InvalidGrantDuration
    );
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Registry::INIT_SPACE, seeds = [b"registry"], bump)]
    pub registry: Account<'info, Registry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [b"registry"], bump = registry.bump, has_one = authority)]
    pub registry: Account<'info, Registry>,
    pub authority: Signer<'info>,
}
#[derive(Accounts)]
#[instruction(dataset_id_hash: [u8; 32], version: u32)]
pub struct CreateDatasetCommitment<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, has_one = authority)]
    pub registry: Account<'info, Registry>,
    #[account(init, payer = authority, space = 8 + DatasetCommitment::INIT_SPACE, seeds = [b"dataset", dataset_id_hash.as_ref(), version.to_le_bytes().as_ref()], bump)]
    pub commitment: Account<'info, DatasetCommitment>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CreateSale<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, has_one = authority, constraint = registry.treasury == treasury.key() @ RegistryError::InvalidTreasury)]
    pub registry: Account<'info, Registry>,
    #[account(seeds = [b"dataset", commitment.dataset_id_hash.as_ref(), commitment.version.to_le_bytes().as_ref()], bump = commitment.bump, has_one = publisher @ RegistryError::UnauthorizedPublisher)]
    pub commitment: Account<'info, DatasetCommitment>,
    #[account(init, payer = authority, space = 8 + Sale::INIT_SPACE, seeds = [b"sale", commitment.key().as_ref()], bump)]
    pub sale: Account<'info, Sale>,
    /// CHECK: equals Registry.treasury and receives a system transfer.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, address = registry.authority)]
    pub authority: Signer<'info>,
    /// CHECK: has_one validates this against the commitment publisher.
    pub publisher: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Purchase<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, constraint = !registry.paused @ RegistryError::RegistryPaused, constraint = registry.treasury == treasury.key() @ RegistryError::InvalidTreasury)]
    pub registry: Account<'info, Registry>,
    #[account(seeds = [b"dataset", commitment.dataset_id_hash.as_ref(), commitment.version.to_le_bytes().as_ref()], bump = commitment.bump, constraint = commitment.status == STATUS_ACTIVE @ RegistryError::CommitmentInactive)]
    pub commitment: Account<'info, DatasetCommitment>,
    #[account(mut, seeds = [b"sale", commitment.key().as_ref()], bump = sale.bump, constraint = sale.dataset_commitment == commitment.key() @ RegistryError::InvalidSale)]
    pub sale: Account<'info, Sale>,
    /// CHECK: equals Registry.treasury and is the transfer destination.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(init, payer = buyer, space = 8 + AccessGrant::INIT_SPACE, seeds = [b"grant", sale.key().as_ref(), buyer.key().as_ref()], bump)]
    pub access_grant: Account<'info, AccessGrant>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CloseSale<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, has_one = authority)]
    pub registry: Account<'info, Registry>,
    #[account(mut, seeds = [b"sale", sale.dataset_commitment.as_ref()], bump = sale.bump)]
    pub sale: Account<'info, Sale>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CreateAccessRound<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, has_one = authority, constraint = registry.treasury == treasury.key() @ RegistryError::InvalidTreasury)]
    pub registry: Account<'info, Registry>,
    #[account(seeds = [b"dataset", commitment.dataset_id_hash.as_ref(), commitment.version.to_le_bytes().as_ref()], bump = commitment.bump, has_one = publisher @ RegistryError::UnauthorizedPublisher)]
    pub commitment: Account<'info, DatasetCommitment>,
    #[account(init, payer = authority, space = 8 + AccessRound::INIT_SPACE, seeds = [b"auction", commitment.key().as_ref()], bump)]
    pub access_round: Account<'info, AccessRound>,
    /// CHECK: equals Registry.treasury and receives winner payments.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, address = registry.authority)]
    pub authority: Signer<'info>,
    /// CHECK: has_one validates this against the commitment publisher.
    pub publisher: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, constraint = !registry.paused @ RegistryError::RegistryPaused)]
    pub registry: Account<'info, Registry>,
    #[account(mut, seeds = [b"auction", access_round.dataset_commitment.as_ref()], bump = access_round.bump)]
    pub access_round: Account<'info, AccessRound>,
    #[account(init, payer = bidder, space = 8 + Bid::INIT_SPACE, seeds = [b"bid", access_round.key().as_ref(), bidder.key().as_ref()], bump)]
    pub bid: Account<'info, Bid>,
    #[account(mut)]
    pub bidder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleAccessRound<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, has_one = authority)]
    pub registry: Account<'info, Registry>,
    #[account(mut, seeds = [b"auction", access_round.dataset_commitment.as_ref()], bump = access_round.bump)]
    pub access_round: Account<'info, AccessRound>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimEntitlement<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, constraint = !registry.paused @ RegistryError::RegistryPaused, constraint = registry.treasury == treasury.key() @ RegistryError::InvalidTreasury)]
    pub registry: Account<'info, Registry>,
    #[account(seeds = [b"dataset", commitment.dataset_id_hash.as_ref(), commitment.version.to_le_bytes().as_ref()], bump = commitment.bump, constraint = commitment.status == STATUS_ACTIVE @ RegistryError::CommitmentInactive)]
    pub commitment: Account<'info, DatasetCommitment>,
    #[account(mut, seeds = [b"auction", commitment.key().as_ref()], bump = access_round.bump, constraint = access_round.dataset_commitment == commitment.key() @ RegistryError::InvalidAuction)]
    pub access_round: Account<'info, AccessRound>,
    #[account(mut, close = bidder, seeds = [b"bid", access_round.key().as_ref(), bidder.key().as_ref()], bump = bid.bump, constraint = bid.access_round == access_round.key() @ RegistryError::InvalidAuction, constraint = bid.bidder == bidder.key() @ RegistryError::BidNotFound)]
    pub bid: Account<'info, Bid>,
    /// CHECK: equals Registry.treasury and receives escrowed winner payment.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(init, payer = bidder, space = 8 + AccessEntitlement::INIT_SPACE, seeds = [b"entitlement", access_round.key().as_ref(), bidder.key().as_ref()], bump)]
    pub entitlement: Account<'info, AccessEntitlement>,
    #[account(mut)]
    pub bidder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundLosingBid<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, constraint = !registry.paused @ RegistryError::RegistryPaused)]
    pub registry: Account<'info, Registry>,
    #[account(seeds = [b"auction", access_round.dataset_commitment.as_ref()], bump = access_round.bump)]
    pub access_round: Account<'info, AccessRound>,
    #[account(mut, close = bidder, seeds = [b"bid", access_round.key().as_ref(), bidder.key().as_ref()], bump = bid.bump, constraint = bid.access_round == access_round.key() @ RegistryError::InvalidAuction, constraint = bid.bidder == bidder.key() @ RegistryError::BidNotFound)]
    pub bid: Account<'info, Bid>,
    #[account(mut)]
    pub bidder: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub schema_version: u16,
    pub paused: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct DatasetCommitment {
    pub dataset_id_hash: [u8; 32],
    pub version: u32,
    pub raw_snapshot_hash: [u8; 32],
    pub normalized_dataset_hash: [u8; 32],
    pub analysis_manifest_hash: [u8; 32],
    pub analysis_result_hash: [u8; 32],
    pub access_policy_hash: [u8; 32],
    pub publisher: Pubkey,
    pub created_at: i64,
    pub max_seats: u32,
    pub allowed_tier_mask: u8,
    pub delayed_version_lag: u32,
    pub delayed_release_seconds: i64,
    pub grant_duration_seconds: i64,
    pub status: u8,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Sale {
    pub dataset_commitment: Pubkey,
    pub treasury: Pubkey,
    pub starts_at: i64,
    pub ends_at: i64,
    pub payment_asset: u8,
    pub early_price_lamports: u64,
    pub delayed_price_lamports: u64,
    pub grant_duration_seconds: i64,
    pub delayed_initial_commitment: Pubkey,
    pub max_seats: u32,
    pub occupied_seats: u32,
    pub enabled_tier_mask: u8,
    pub status: u8,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct AccessGrant {
    pub dataset_commitment: Pubkey,
    pub sale: Pubkey,
    pub buyer: Pubkey,
    pub dataset_id_hash: [u8; 32],
    pub purchased_version: u32,
    pub tier: u8,
    pub granted_at: i64,
    pub expires_at: i64,
    pub status: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct BidEntry {
    pub bidder: Pubkey,
    pub amount_lamports: u64,
    pub tier: u8,
    pub placed_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct AccessRound {
    pub dataset_commitment: Pubkey,
    pub treasury: Pubkey,
    pub opens_at: i64,
    pub closes_at: i64,
    pub minimum_bid_lamports: u64,
    pub max_winners: u32,
    pub bid_count: u32,
    pub winners_count: u32,
    pub claimed_count: u32,
    pub enabled_tier_mask: u8,
    pub settlement_rule: u8,
    pub status: u8,
    pub clearing_price_lamports: u64,
    #[max_len(32)]
    pub bids: Vec<BidEntry>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub access_round: Pubkey,
    pub bidder: Pubkey,
    pub amount_lamports: u64,
    pub tier: u8,
    pub placed_at: i64,
    pub status: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AccessEntitlement {
    pub dataset_commitment: Pubkey,
    pub access_round: Pubkey,
    pub wallet: Pubkey,
    pub dataset_id_hash: [u8; 32],
    pub purchased_version: u32,
    pub tier: u8,
    pub granted_at: i64,
    pub expires_at: i64,
    pub bid_amount_lamports: u64,
    pub status: u8,
    pub bump: u8,
}

#[error_code]
pub enum RegistryError {
    #[msg("A commitment hash must not be empty")]
    EmptyHash,
    #[msg("Only the configured publisher may perform this action")]
    UnauthorizedPublisher,
    #[msg("Registry is paused")]
    RegistryPaused,
    #[msg("Dataset commitment is inactive")]
    CommitmentInactive,
    #[msg("Dataset version must be positive")]
    InvalidVersion,
    #[msg("Maximum seats must be positive")]
    InvalidSeatCount,
    #[msg("Invalid tier mask or tier")]
    InvalidTier,
    #[msg("Invalid delayed-access policy")]
    InvalidDelayedPolicy,
    #[msg("Invalid grant duration")]
    InvalidGrantDuration,
    #[msg("Treasury does not match the registry")]
    InvalidTreasury,
    #[msg("Sale window is invalid")]
    InvalidSaleWindow,
    #[msg("Price must be positive")]
    InvalidPrice,
    #[msg("Sale is inactive")]
    SaleInactive,
    #[msg("Sale is not currently open")]
    SaleNotOpen,
    #[msg("Only SOL payment is supported in this MVP")]
    UnsupportedPaymentAsset,
    #[msg("Requested tier is not for sale")]
    TierUnavailable,
    #[msg("All on-chain seats are occupied")]
    SeatsExhausted,
    #[msg("Seat counter overflow")]
    SeatOverflow,
    #[msg("Sale does not belong to this commitment")]
    InvalidSale,
    #[msg("Access-round window is invalid")]
    InvalidAuctionWindow,
    #[msg("Winner count must be between one and the committed seat cap")]
    InvalidWinnerCount,
    #[msg("Bid amount is below the on-chain minimum")]
    InvalidBidAmount,
    #[msg("Access round is inactive")]
    AuctionInactive,
    #[msg("Access round is not open")]
    AuctionNotOpen,
    #[msg("Access round has reached its bounded bid capacity")]
    AuctionBidCapacityReached,
    #[msg("Access round is still open")]
    AuctionStillOpen,
    #[msg("Access round has not settled")]
    AuctionNotSettled,
    #[msg("Bid is not active")]
    BidInactive,
    #[msg("Bid is not present in the on-chain leaderboard")]
    BidNotFound,
    #[msg("Wallet is not a Top-N winner")]
    NotAuctionWinner,
    #[msg("A winning bid cannot be refunded")]
    AuctionWinnerCannotRefund,
    #[msg("Access round does not belong to this commitment")]
    InvalidAuction,
    #[msg("Bid escrow balance is invalid")]
    InvalidBidEscrow,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_complete_commitment_policy() {
        assert!(validate_commitment(
            [1; 32], 1, [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], 10, 3, 1, 0, 86_400
        )
        .is_ok());
    }
    #[test]
    fn rejects_empty_hashes_and_invalid_controls() {
        assert!(validate_commitment(
            [0; 32], 1, [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], 10, 3, 1, 0, 86_400
        )
        .is_err());
        assert!(validate_commitment(
            [1; 32], 0, [2; 32], [3; 32], [4; 32], [5; 32], [6; 32], 0, 4, 0, -1, 0
        )
        .is_err());
    }

    #[test]
    fn ranks_bids_by_amount_then_time_then_wallet() {
        let mut bids = vec![
            BidEntry {
                bidder: Pubkey::new_from_array([3; 32]),
                amount_lamports: 20,
                tier: 1,
                placed_at: 20,
            },
            BidEntry {
                bidder: Pubkey::new_from_array([2; 32]),
                amount_lamports: 20,
                tier: 1,
                placed_at: 10,
            },
            BidEntry {
                bidder: Pubkey::new_from_array([1; 32]),
                amount_lamports: 20,
                tier: 2,
                placed_at: 10,
            },
            BidEntry {
                bidder: Pubkey::new_from_array([4; 32]),
                amount_lamports: 10,
                tier: 1,
                placed_at: 1,
            },
        ];
        rank_bid_entries(&mut bids);
        assert_eq!(
            bids.iter()
                .map(|entry| entry.bidder.to_bytes()[0])
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4]
        );
    }

    #[test]
    fn winner_count_is_bounded_by_available_bids() {
        assert_eq!(winner_count(3, 0), 0);
        assert_eq!(winner_count(3, 2), 2);
        assert_eq!(winner_count(3, 8), 3);
    }
}
