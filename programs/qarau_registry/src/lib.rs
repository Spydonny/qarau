#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod contracts;

declare_id!("5n92bg5CrZrt956eXmakgAiqesbfFav7mdNqsfk8Ex3u");

#[program]
pub mod qarau_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.bump = ctx.bumps.registry;
        registry.schema_version = 1;
        Ok(())
    }

    pub fn commit_merkle_root(
        ctx: Context<CommitMerkleRoot>,
        epoch: u64,
        root: [u8; 32],
        schema_version: u16,
    ) -> Result<()> {
        validate_commitment(root, schema_version, ctx.accounts.registry.schema_version)?;
        let commitment = &mut ctx.accounts.commitment;
        commitment.authority = ctx.accounts.authority.key();
        commitment.epoch = epoch;
        commitment.root = root;
        commitment.schema_version = schema_version;
        commitment.slot = Clock::get()?.slot;
        commitment.bump = ctx.bumps.commitment;
        Ok(())
    }
}

fn validate_commitment(root: [u8; 32], schema_version: u16, registry_version: u16) -> Result<()> {
    require!(root != [0; 32], RegistryError::EmptyRoot);
    require!(schema_version == registry_version, RegistryError::UnsupportedSchema);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Registry::INIT_SPACE,
        seeds = [b"registry"],
        bump
    )]
    pub registry: Account<'info, Registry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch: u64)]
pub struct CommitMerkleRoot<'info> {
    #[account(seeds = [b"registry"], bump = registry.bump, has_one = authority)]
    pub registry: Account<'info, Registry>,
    #[account(
        init,
        payer = authority,
        space = 8 + EpochCommitment::INIT_SPACE,
        seeds = [b"epoch".as_ref(), epoch.to_le_bytes().as_ref()],
        bump
    )]
    pub commitment: Account<'info, EpochCommitment>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub authority: Pubkey,
    pub schema_version: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EpochCommitment {
    pub authority: Pubkey,
    pub epoch: u64,
    pub root: [u8; 32],
    pub schema_version: u16,
    pub slot: u64,
    pub bump: u8,
}

#[error_code]
pub enum RegistryError {
    #[msg("Merkle root must not be empty")]
    EmptyRoot,
    #[msg("Unsupported commitment schema")]
    UnsupportedSchema,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_nonzero_root_for_registry_schema() {
        assert!(validate_commitment([7; 32], 1, 1).is_ok());
    }

    #[test]
    fn rejects_empty_root_and_wrong_schema() {
        assert!(validate_commitment([0; 32], 1, 1).is_err());
        assert!(validate_commitment([7; 32], 2, 1).is_err());
    }
}
