module lofi_yeti_runner::yeti_game {
    use std::string::{Self, String};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// Error codes
    const EInvalidAmount: u64 = 1;
    const EInvalidScore: u64 = 2;

    /// Player's persistent on-chain runner profile & reward ledger on Sui
    public struct YetiRunnerPass has key, store {
        id: UID,
        owner: address,
        claimed_lofi_coins: u64,
        best_score: u64,
        best_distance_m: u64,
        total_runs_verified: u64,
    }

    /// Playable Lofi Mystic Yeti NFT minted on Sui
    public struct YetiCharacterNFT has key, store {
        id: UID,
        character_id: String,
        name: String,
        tier: String,
        home_world: String,
        perk_name: String,
        minted_by: address,
    }

    /// Emitted when earned run coins are claimed on-chain
    public struct RunRewardsClaimed has copy, drop {
        player: address,
        amount: u64,
        total_claimed: u64,
    }

    /// Emitted when a Yeti character is minted as a Sui NFT
    public struct YetiMinted has copy, drop {
        player: address,
        character_id: String,
        name: String,
        tier: String,
    }

    /// Emitted when a runner submits a verified high-score proof
    public struct HighScoreSubmitted has copy, drop {
        player: address,
        score: u64,
        distance_m: u64,
        character_id: String,
    }

    /// Creates a personal YetiRunnerPass for the caller
    public entry fun create_runner_pass(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let pass = YetiRunnerPass {
            id: object::new(ctx),
            owner: sender,
            claimed_lofi_coins: 0,
            best_score: 0,
            best_distance_m: 0,
            total_runs_verified: 0,
        };
        transfer::public_transfer(pass, sender);
    }

    /// Records claimed SUI Runner Coins onto the player's YetiRunnerPass
    public entry fun claim_run_rewards(
        pass: &mut YetiRunnerPass,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(amount > 0, EInvalidAmount);
        pass.claimed_lofi_coins = pass.claimed_lofi_coins + amount;
        event::emit(RunRewardsClaimed {
            player: tx_context::sender(ctx),
            amount,
            total_claimed: pass.claimed_lofi_coins,
        });
    }

    /// Mints an unlocked Lofi Mystic Yeti as a transferable Sui NFT
    public entry fun mint_yeti_nft(
        character_id: vector<u8>,
        name: vector<u8>,
        tier: vector<u8>,
        home_world: vector<u8>,
        perk_name: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let cid = string::utf8(character_id);
        let cname = string::utf8(name);
        let ctier = string::utf8(tier);

        event::emit(YetiMinted {
            player: sender,
            character_id: cid,
            name: cname,
            tier: ctier,
        });

        let nft = YetiCharacterNFT {
            id: object::new(ctx),
            character_id: cid,
            name: cname,
            tier: ctier,
            home_world: string::utf8(home_world),
            perk_name: string::utf8(perk_name),
            minted_by: sender,
        };
        transfer::public_transfer(nft, sender);
    }

    /// Submits a run score & distance milestone onto the player's on-chain pass
    public entry fun submit_run_score(
        pass: &mut YetiRunnerPass,
        score: u64,
        distance_m: u64,
        character_id: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(score > 0, EInvalidScore);
        if (score > pass.best_score) {
            pass.best_score = score;
        };
        if (distance_m > pass.best_distance_m) {
            pass.best_distance_m = distance_m;
        };
        pass.total_runs_verified = pass.total_runs_verified + 1;

        event::emit(HighScoreSubmitted {
            player: tx_context::sender(ctx),
            score,
            distance_m,
            character_id: string::utf8(character_id),
        });
    }
}
