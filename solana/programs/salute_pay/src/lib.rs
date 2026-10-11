use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, CreateAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, TransferChecked};

use solana_sdk_ids::ed25519_program;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
include!(concat!(env!("OUT_DIR"), "/network_domain.rs"));

declare_id!("B2hF4D7ojHWbXkkFmSSApyR3ohuc8RY2bFiQe8z5foTj");

#[program]
pub mod salute_pay {
    use super::*;
    /// Read the deployment's immutable network domain by transaction simulation.
    pub fn network_domain(_ctx: Context<NetworkDomain>) -> Result<[u8; 32]> { Ok(NETWORK_DOMAIN) }

    /// Permissionless issuance for test mints explicitly assigned to this separate PDA.
    /// This authority cannot sign for payment order/vault PDAs.
    pub fn mint_test_tokens(ctx: Context<MintTestTokens>, amount: u64) -> Result<()> {
        require!(amount > 0 && amount <= 1_000_000_000_000, SaluteError::InvalidAmount);
        let bump = [ctx.bumps.authority];
        token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.key(), MintTo {
            mint: ctx.accounts.mint.to_account_info(), to: ctx.accounts.recipient.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        }, &[&[b"test-mint-authority", &bump]]), amount)
    }

    pub fn register_sol(
        ctx: Context<RegisterSol>,
        order_id: [u8; 32],
        amount: u64,
        executor_reward: u64,
    ) -> Result<()> {
        validate_amount(amount, executor_reward)?;
        verify_intent(&ctx.accounts.instructions.to_account_info(), ctx.accounts.merchant.key(),
            order_id, Pubkey::default(), amount, executor_reward)?;
        let order_key = ctx.accounts.order.key();
        let vault_bump = ctx.bumps.vault;
        let bump_seed = [vault_bump];
        let signer_seeds: &[&[u8]] = &[b"vault", order_key.as_ref(), &bump_seed];
        let reserve = create_system_vault(
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            signer_seeds,
        )?;
        let order = &mut ctx.accounts.order;
        order.order_id = order_id;
        order.merchant = ctx.accounts.merchant.key();
        order.mint = Pubkey::default();
        order.amount = amount;
        order.executor_reward = executor_reward;
        order.vault_reserve = reserve;
        order.bump = ctx.bumps.order;
        order.vault_bump = vault_bump;
        emit!(OrderRegistered {
            order: order_key,
            vault: ctx.accounts.vault.key(),
            merchant: order.merchant,
            mint: order.mint,
            amount,
            executor_reward,
        });
        Ok(())
    }

    pub fn register_token(
        ctx: Context<RegisterToken>,
        order_id: [u8; 32],
        amount: u64,
        executor_reward: u64,
    ) -> Result<()> {
        validate_amount(amount, executor_reward)?;
        verify_intent(&ctx.accounts.instructions.to_account_info(), ctx.accounts.merchant.key(),
            order_id, ctx.accounts.mint.key(), amount, executor_reward)?;
        let order_key = ctx.accounts.order.key();
        let vault_bump = ctx.bumps.vault;
        let bump_seed = [vault_bump];
        let signer_seeds: &[&[u8]] = &[b"vault", order_key.as_ref(), &bump_seed];
        let reserve = create_system_vault(
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            signer_seeds,
        )?;
        let order = &mut ctx.accounts.order;
        order.order_id = order_id;
        order.merchant = ctx.accounts.merchant.key();
        order.mint = ctx.accounts.mint.key();
        order.amount = amount;
        order.executor_reward = executor_reward;
        order.vault_reserve = reserve;
        order.bump = ctx.bumps.order;
        order.vault_bump = vault_bump;
        emit!(OrderRegistered {
            order: order_key,
            vault: ctx.accounts.vault.key(),
            merchant: order.merchant,
            mint: order.mint,
            amount,
            executor_reward,
        });
        Ok(())
    }

    pub fn collect_sol(ctx: Context<SettleSol>, waive_reward: bool) -> Result<()> {
        let order = &mut ctx.accounts.order;
        require_keys_eq!(*ctx.accounts.vault.owner, system_program::ID, SaluteError::WrongVault);
        let balance = ctx.accounts.vault.lamports();
        let available = balance.checked_sub(order.vault_reserve).ok_or(SaluteError::InsufficientFunding)?;
        require!(available > 0, SaluteError::NothingToSweep);
        let eligible = order.mint == Pubkey::default() && !waive_reward;
        let reward = if eligible && ctx.accounts.executor.key() != order.merchant { order.executor_reward } else { 0 };
        let merchant_amount = available.checked_sub(reward).ok_or(SaluteError::InvalidAmount)?;
        require!(merchant_amount > 0, SaluteError::InsufficientFunding);
        let order_key = order.key();
        let bump_seed = [order.vault_bump];
        let signer_seeds: &[&[u8]] = &[b"vault", order_key.as_ref(), &bump_seed];
        transfer_sol(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.merchant.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            if ctx.accounts.executor.key() == ctx.accounts.merchant.key() { available } else { merchant_amount },
            signer_seeds,
        )?;
        if reward > 0 && ctx.accounts.executor.key() != ctx.accounts.merchant.key() {
            transfer_sol(
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.executor.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                reward,
                signer_seeds,
            )?;
        }
        emit!(PaymentCollected {
            order: order_key,
            asset: Pubkey::default(),
            invoice_amount: order.amount,
            received: available,
            merchant_amount: if ctx.accounts.executor.key() == ctx.accounts.merchant.key() { available } else { merchant_amount },
            executor_reward: reward,
            executor: ctx.accounts.executor.key(),
        });
        Ok(())
    }

    pub fn collect_token(ctx: Context<SettleToken>, waive_reward: bool) -> Result<()> {
        let order = &mut ctx.accounts.order;
        let balance = ctx.accounts.vault_token.amount;
        require!(balance > 0, SaluteError::NothingToSweep);
        let eligible = order.mint == ctx.accounts.mint.key() && !waive_reward;
        let reward = if eligible && ctx.accounts.executor.key() != order.merchant { order.executor_reward } else { 0 };
        let merchant_amount = balance.checked_sub(reward).ok_or(SaluteError::InvalidAmount)?;
        if reward > 0 && ctx.accounts.executor.key() != ctx.accounts.merchant.key() {
            require_keys_eq!(*ctx.accounts.executor_token.owner, token::ID, SaluteError::WrongExecutorToken);
            let token_data = ctx.accounts.executor_token.try_borrow_data()?;
            let executor_token = TokenAccount::try_deserialize(&mut &token_data[..])?;
            require_keys_eq!(executor_token.mint, ctx.accounts.mint.key(), SaluteError::WrongAsset);
            require_keys_eq!(executor_token.owner, ctx.accounts.executor.key(), SaluteError::WrongExecutorToken);
        }
        require!(merchant_amount > 0, SaluteError::InsufficientFunding);
        let order_key = order.key();
        let bump_seed = [order.vault_bump];
        let signer_seeds: &[&[u8]] = &[b"vault", order_key.as_ref(), &bump_seed];
        let signers: &[&[&[u8]]] = &[signer_seeds];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.merchant_token.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signers,
            ),
            if ctx.accounts.executor.key() == ctx.accounts.merchant.key() { balance } else { merchant_amount },
            ctx.accounts.mint.decimals,
        )?;
        if reward > 0 && ctx.accounts.executor.key() != ctx.accounts.merchant.key() {
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault_token.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.executor_token.to_account_info(),
                        authority: ctx.accounts.vault.to_account_info(),
                    },
                    signers,
                ),
                reward,
                ctx.accounts.mint.decimals,
            )?;
        }
        emit!(PaymentCollected {
            order: order_key,
            asset: ctx.accounts.mint.key(),
            invoice_amount: order.amount,
            received: balance,
            merchant_amount: if ctx.accounts.executor.key() == ctx.accounts.merchant.key() { balance } else { merchant_amount },
            executor_reward: reward,
            executor: ctx.accounts.executor.key(),
        });
        Ok(())
    }


}

fn validate_amount(amount: u64, reward: u64) -> Result<()> {
    require!(amount > 0 && reward < amount, SaluteError::InvalidAmount);
    Ok(())
}

fn create_system_vault<'info>(
    merchant: &AccountInfo<'info>,
    vault: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
) -> Result<u64> {
    require!(vault.data_is_empty() && *vault.owner == system_program::ID, SaluteError::WrongVault);
    let reserve = Rent::get()?.minimum_balance(0);
    // A permissionless dust transfer must not make a signed order unpayable.
    if vault.lamports() > 0 {
        system_program::transfer(CpiContext::new(*system.key, Transfer {
            from: merchant.clone(), to: vault.clone(),
        }), reserve)?;
        return Ok(reserve);
    }
    system_program::create_account(
        CpiContext::new_with_signer(
            *system.key,
            CreateAccount { from: merchant.clone(), to: vault.clone() },
            &[signer_seeds],
        ),
        reserve,
        0,
        &system_program::ID,
    )?;
    Ok(reserve)
}

fn transfer_sol<'info>(
    vault: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    amount: u64,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    system_program::transfer(
        CpiContext::new_with_signer(
            *system.key,
            Transfer { from: vault.clone(), to: recipient.clone() },
            &[signer_seeds],
        ),
        amount,
    )
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 32], amount: u64, executor_reward: u64)]
pub struct RegisterSol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Merchant identity authenticated by the preceding Ed25519 instruction.
    pub merchant: UncheckedAccount<'info>,
    /// CHECK: Canonical instruction sysvar required for signature introspection.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = 8 + OrderState::INIT_SPACE,
        seeds = [b"order", merchant.key().as_ref(), order_id.as_ref(), Pubkey::default().as_ref(), &amount.to_le_bytes(), &executor_reward.to_le_bytes(), &NETWORK_DOMAIN], bump)]
    pub order: Account<'info, OrderState>,
    /// CHECK: Derived by this program; created as a zero-data System-owned PDA.
    #[account(mut, seeds = [b"vault", order.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 32], amount: u64, executor_reward: u64)]
pub struct RegisterToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Merchant identity authenticated by the preceding Ed25519 instruction.
    pub merchant: UncheckedAccount<'info>,
    /// CHECK: Canonical instruction sysvar required for signature introspection.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = 8 + OrderState::INIT_SPACE,
        seeds = [b"order", merchant.key().as_ref(), order_id.as_ref(), mint.key().as_ref(), &amount.to_le_bytes(), &executor_reward.to_le_bytes(), &NETWORK_DOMAIN], bump)]
    pub order: Account<'info, OrderState>,
    /// CHECK: Derived by this program; created as a zero-data System-owned PDA.
    #[account(mut, seeds = [b"vault", order.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = payer, associated_token::mint = mint,
        associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleSol<'info> {
    #[account(mut, seeds = [b"order", order.merchant.as_ref(), order.order_id.as_ref(), order.mint.as_ref(), &order.amount.to_le_bytes(), &order.executor_reward.to_le_bytes(), &NETWORK_DOMAIN], bump = order.bump)]
    pub order: Account<'info, OrderState>,
    /// CHECK: PDA seeds and System ownership are verified.
    #[account(mut, seeds = [b"vault", order.key().as_ref()], bump = order.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, address = order.merchant)]
    pub merchant: SystemAccount<'info>,
    #[account(mut)]
    pub executor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleToken<'info> {
    #[account(mut, seeds = [b"order", order.merchant.as_ref(), order.order_id.as_ref(), order.mint.as_ref(), &order.amount.to_le_bytes(), &order.executor_reward.to_le_bytes(), &NETWORK_DOMAIN], bump = order.bump)]
    pub order: Account<'info, OrderState>,
    /// CHECK: PDA seeds are verified; vault signs only for this order.
    #[account(seeds = [b"vault", order.key().as_ref()], bump = order.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_token: Account<'info, TokenAccount>,
    /// CHECK: Key is checked against immutable order.merchant.
    #[account(address = order.merchant)]
    pub merchant: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = merchant)]
    pub merchant_token: Account<'info, TokenAccount>,
    pub executor: Signer<'info>,
    /// CHECK: Parsed and validated as a token account only when reward is paid.
    #[account(mut)]
    pub executor_token: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct OrderState {
    pub order_id: [u8; 32],
    pub merchant: Pubkey,
    /// Native SOL uses Pubkey::default(); otherwise a classic SPL mint.
    pub mint: Pubkey,
    /// Invoice expectation only; never a collection minimum.
    pub amount: u64,
    pub executor_reward: u64,
    /// System-owned vault rent retained for late deposits, excluded from invoice funds.
    pub vault_reserve: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[event]
pub struct OrderRegistered {
    pub order: Pubkey,
    pub vault: Pubkey,
    pub merchant: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub executor_reward: u64,
}

#[event]
pub struct PaymentCollected {
    pub order: Pubkey,
    pub asset: Pubkey,
    pub invoice_amount: u64,
    pub received: u64,
    pub merchant_amount: u64,
    pub executor_reward: u64,
    pub executor: Pubkey,
}

#[event]
pub struct LatePaymentSwept {
    pub order: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum SaluteError {
    #[msg("Missing or invalid merchant signature") ]
    InvalidSignature,
    #[msg("Amount must be positive and reward must be lower than amount")]
    InvalidAmount,
    #[msg("Order does not have enough customer funds")]
    InsufficientFunding,
    #[msg("Order was already settled")]
    AlreadySettled,
    #[msg("Order is not yet settled")]
    NotSettled,
    #[msg("No late funds to sweep")]
    NothingToSweep,
    #[msg("Wrong asset or mint")]
    WrongAsset,
    #[msg("Vault address or owner is invalid")]
    WrongVault,
    #[msg("Vault account already exists")]
    VaultAlreadyExists,
    #[msg("Executor token account is not owned by the caller")]
    WrongExecutorToken,
}

#[derive(Accounts)]
pub struct NetworkDomain {}

#[derive(Accounts)]
pub struct MintTestTokens<'info> {
    /// CHECK: Dedicated test issuance PDA; SPL verifies mint authority during CPI.
    #[account(seeds = [b"test-mint-authority"], bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, constraint = mint.decimals == 6)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = caller)]
    pub recipient: Account<'info, TokenAccount>,
    pub caller: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/// Human-readable canonical signed message. Fixed field order, no ambiguous concatenation.
fn intent_message(merchant: Pubkey, id: [u8; 32], mint: Pubkey, amount: u64, reward: u64) -> Vec<u8> {
    let hex = |bytes: &[u8]| bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    format!("Salute Payment Intent\nNetwork: {}\nProgram: {}\nOrder: {}\nMerchant: {}\nMint: {}\nAmount: {}\nExecutor reward: {}\n", hex(&NETWORK_DOMAIN), crate::ID, hex(&id), merchant, mint, amount, reward).into_bytes()
}

fn verify_intent(instructions: &AccountInfo, merchant: Pubkey, id: [u8; 32], mint: Pubkey, amount: u64, reward: u64) -> Result<()> {
    let index = load_current_index_checked(instructions)?;
    require!(index > 0, SaluteError::InvalidSignature);
    let ix = load_instruction_at_checked((index - 1) as usize, instructions)?;
    require_keys_eq!(ix.program_id, ed25519_program::ID, SaluteError::InvalidSignature);
    let d = &ix.data;
    require!(ix.accounts.is_empty() && d.len() >= 16 && d[0] == 1 && d[1] == 0, SaluteError::InvalidSignature);
    let read = |at: usize| u16::from_le_bytes([d[at], d[at + 1]]) as usize;
    // Reject cross-instruction references; the native verifier and this parser must read identical data.
    require!(read(4) == 65535 && read(8) == 65535 && read(14) == 65535, SaluteError::InvalidSignature);
    let sig = read(2); let key = read(6); let msg = read(10); let len = read(12);
    require!(sig >= 16 && key >= 16 && msg >= 16 && sig + 64 <= d.len() && key + 32 <= d.len() && msg + len <= d.len(), SaluteError::InvalidSignature);
    require!(d[key..key + 32] == merchant.to_bytes(), SaluteError::InvalidSignature);
    require!(d[msg..msg + len] == intent_message(merchant, id, mint, amount, reward), SaluteError::InvalidSignature);
    Ok(())
}
