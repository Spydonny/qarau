#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

pub mod contracts;

declare_id!("5n92bg5CrZrt956eXmakgAiqesbfFav7mdNqsfk8Ex3u");

pub const TIER_EXCLUSIVE_EARLY: u8 = 1;
pub const TIER_DELAYED: u8 = 2;
pub const STATUS_ACTIVE: u8 = 1;
pub const STATUS_CLOSED: u8 = 2;
pub const PAYMENT_SOL: u8 = 0;

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
}
