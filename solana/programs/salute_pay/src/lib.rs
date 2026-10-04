use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, CreateAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("Ei1U3obSXWF7FzRR5jscAWesvkj7Jgmntit9A9upyBvH");

#[program]
pub mod salute_pay {
    use super::*;

    pub fn register_sol(
        ctx: Context<RegisterSol>,
        order_id: [u8; 32],
        amount: u64,
        executor_reward: u64,
    ) -> Result<()> {
        validate_amount(amount, executor_reward)?;
        let order_key = ctx.accounts.order.key();
        let vault_bump = ctx.bumps.vault;
        let bump_seed = [vault_bump];
        let signer_seeds: &[&[u8]] = &[b"vault", order_key.as_ref(), &bump_seed];
        let reserve = create_system_vault(
            &ctx.accounts.merchant.to_account_info(),
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
        order.settled = false;
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
        let order_key = ctx.accounts.order.key();
        let vault_bump = ctx.bumps.vault;
        let bump_seed = [vault_bump];
        let signer_seeds: &[&[u8]] = &[b"vault", order_key.as_ref(), &bump_seed];
        let reserve = create_system_vault(
            &ctx.accounts.merchant.to_account_info(),
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
        order.settled = false;
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

    pub fn settle_sol(ctx: Context<SettleSol>) -> Result<()> {
        let order = &mut ctx.accounts.order;
        require!(!order.settled, SaluteError::AlreadySettled);
        require_keys_eq!(order.mint, Pubkey::default(), SaluteError::WrongAsset);
        require_keys_eq!(*ctx.accounts.vault.owner, system_program::ID, SaluteError::WrongVault);
        let balance = ctx.accounts.vault.lamports();
        let available = balance.checked_sub(order.vault_reserve).ok_or(SaluteError::InsufficientFunding)?;
        require!(available >= order.amount, SaluteError::InsufficientFunding);
        let reward = order.executor_reward;
        let merchant_amount = available.checked_sub(reward).ok_or(SaluteError::InvalidAmount)?;
        order.settled = true;
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
        emit!(OrderSettled {
            order: order_key,
            merchant_amount: if ctx.accounts.executor.key() == ctx.accounts.merchant.key() { available } else { merchant_amount },
            executor_reward: reward,
            executor: ctx.accounts.executor.key(),
        });
        Ok(())
    }

    pub fn settle_token(ctx: Context<SettleToken>) -> Result<()> {
        let order = &mut ctx.accounts.order;
        require!(!order.settled, SaluteError::AlreadySettled);
        require_keys_eq!(order.mint, ctx.accounts.mint.key(), SaluteError::WrongAsset);
        let balance = ctx.accounts.vault_token.amount;
        require!(balance >= order.amount, SaluteError::InsufficientFunding);
        let reward = order.executor_reward;
        let merchant_amount = balance.checked_sub(reward).ok_or(SaluteError::InvalidAmount)?;
        if reward > 0 && ctx.accounts.executor.key() != ctx.accounts.merchant.key() {
            require_keys_eq!(*ctx.accounts.executor_token.owner, token::ID, SaluteError::WrongExecutorToken);
            let token_data = ctx.accounts.executor_token.try_borrow_data()?;
            let executor_token = TokenAccount::try_deserialize(&mut &token_data[..])?;
            require_keys_eq!(executor_token.mint, order.mint, SaluteError::WrongAsset);
            require_keys_eq!(executor_token.owner, ctx.accounts.executor.key(), SaluteError::WrongExecutorToken);
        }
        order.settled = true;
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
        emit!(OrderSettled {
            order: order_key,
            merchant_amount: if ctx.accounts.executor.key() == ctx.accounts.merchant.key() { balance } else { merchant_amount },
            executor_reward: reward,
            executor: ctx.accounts.executor.key(),
        });
        Ok(())
    }

    pub fn sweep_late_sol(ctx: Context<SettleSol>) -> Result<()> {
        require!(ctx.accounts.order.settled, SaluteError::NotSettled);
        require_keys_eq!(ctx.accounts.order.mint, Pubkey::default(), SaluteError::WrongAsset);
        require_keys_eq!(*ctx.accounts.vault.owner, system_program::ID, SaluteError::WrongVault);
        let balance = ctx.accounts.vault.lamports();
        let sweep_amount = balance.checked_sub(ctx.accounts.order.vault_reserve).ok_or(SaluteError::WrongVault)?;
        require!(sweep_amount > 0, SaluteError::NothingToSweep);
        let order_key = ctx.accounts.order.key();
        let bump_seed = [ctx.accounts.order.vault_bump];
        let signer_seeds: &[&[u8]] = &[b"vault", order_key.as_ref(), &bump_seed];
        transfer_sol(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.merchant.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            sweep_amount,
            signer_seeds,
        )?;
        emit!(LatePaymentSwept { order: order_key, amount: sweep_amount });
        Ok(())
    }

    pub fn sweep_late_token(ctx: Context<SettleToken>) -> Result<()> {
        require!(ctx.accounts.order.settled, SaluteError::NotSettled);
        require_keys_eq!(ctx.accounts.order.mint, ctx.accounts.mint.key(), SaluteError::WrongAsset);
        let balance = ctx.accounts.vault_token.amount;
        require!(balance > 0, SaluteError::NothingToSweep);
        let order_key = ctx.accounts.order.key();
        let bump_seed = [ctx.accounts.order.vault_bump];
        let signer_seeds: &[&[u8]] = &[b"vault", order_key.as_ref(), &bump_seed];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.merchant_token.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[signer_seeds],
            ),
            balance,
            ctx.accounts.mint.decimals,
        )?;
        emit!(LatePaymentSwept { order: order_key, amount: balance });
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
    require!(vault.lamports() == 0 && vault.data_is_empty(), SaluteError::VaultAlreadyExists);
    let reserve = Rent::get()?.minimum_balance(0);
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
#[instruction(order_id: [u8; 32])]
pub struct RegisterSol<'info> {
    #[account(mut)]
    pub merchant: Signer<'info>,
    #[account(init, payer = merchant, space = 8 + OrderState::INIT_SPACE,
        seeds = [b"order", merchant.key().as_ref(), order_id.as_ref()], bump)]
    pub order: Account<'info, OrderState>,
    /// CHECK: Derived by this program; created as a zero-data System-owned PDA.
    #[account(mut, seeds = [b"vault", order.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 32])]
pub struct RegisterToken<'info> {
    #[account(mut)]
    pub merchant: Signer<'info>,
    #[account(init, payer = merchant, space = 8 + OrderState::INIT_SPACE,
        seeds = [b"order", merchant.key().as_ref(), order_id.as_ref()], bump)]
    pub order: Account<'info, OrderState>,
    /// CHECK: Derived by this program; created as a zero-data System-owned PDA.
    #[account(mut, seeds = [b"vault", order.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = merchant, associated_token::mint = mint,
        associated_token::authority = vault, associated_token::token_program = token_program)]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleSol<'info> {
    #[account(mut, seeds = [b"order", order.merchant.as_ref(), order.order_id.as_ref()], bump = order.bump)]
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
    #[account(mut, seeds = [b"order", order.merchant.as_ref(), order.order_id.as_ref()], bump = order.bump)]
    pub order: Account<'info, OrderState>,
    /// CHECK: PDA seeds are verified; vault signs only for this order.
    #[account(seeds = [b"vault", order.key().as_ref()], bump = order.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(address = order.mint)]
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
    /// Customer amount inclusive of executor reward, in base units.
    pub amount: u64,
    pub executor_reward: u64,
    /// System-owned vault account funding returned to the merchant at settlement.
    pub vault_reserve: u64,
    pub settled: bool,
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
pub struct OrderSettled {
    pub order: Pubkey,
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
