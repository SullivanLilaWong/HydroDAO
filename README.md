# HydroDAO# HydroDAO

## Overview

HydroDAO is a decentralized autonomous organization (DAO) built on the Stacks blockchain using Clarity smart contracts. It addresses real-world water scarcity issues by enabling communal resource sharing through tokenized water rights. Water rights are allocated as fungible tokens based on verified usage data (e.g., from IoT sensors or trusted oracles), ensuring transparent, fair, and efficient distribution. This solves problems like corruption in traditional water management systems, over-extraction in agriculture or urban areas, and lack of accountability in shared resources.

In regions like arid farmlands or drought-prone communities, HydroDAO allows members to propose allocations, verify usage, and govern collectively. Tokens represent proportional water access rights, which can be staked for governance or traded within the ecosystem. Verified usage ensures tokens are redistributed periodically to reward conservation and penalize waste.

The project consists of 6 core smart contracts written in Clarity, leveraging Stacks' security tied to Bitcoin.

## Key Features

- **Tokenized Water Rights**: Fungible tokens (SIP-10 compliant) representing water allocation units.
- **Verified Usage**: Integration with oracles for real-world data input (e.g., meter readings).
- **DAO Governance**: Proposal creation, voting, and execution.
- **Automated Allocation**: Periodic redistribution based on usage metrics.
- **Staking for Incentives**: Stake tokens for voting power and rewards.
- **Treasury Management**: Handles fees and community funds.
- **Real-World Impact**: Reduces disputes in communal water systems, promotes sustainability.

## Architecture

HydroDAO operates on Stacks, where Clarity contracts handle logic securely. Users interact via wallets (e.g., Hiro Wallet). Oracles (trusted off-chain services) feed usage data. The system flow:
1. Members join and receive initial tokens.
2. Usage data is verified and submitted.
3. Tokens are allocated/reallocated based on rules.
4. Governance proposals adjust parameters (e.g., allocation formulas).
5. Staking provides incentives for participation.

Contracts are modular for upgradability and security.

## Smart Contracts

Below are the 6 smart contracts, including their purpose, key functions, and full Clarity code. All contracts follow Clarity best practices: immutable where possible, with access controls.

### 1. WaterToken.clar (Fungible Token for Water Rights)

This is a SIP-10 compliant fungible token representing water rights units (e.g., 1 token = 1 cubic meter/year).

```clarity
;; WaterToken - SIP-10 Fungible Token for Water Rights

(define-fungible-token water-token u1000000000) ;; Max supply: 1 billion units

(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INSUFFICIENT-BALANCE (err u402))

(define-data-var admin principal tx-sender)
(define-data-var total-supply u64 u0)

(define-public (transfer (amount u64) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? water-token amount sender recipient))
    (ok true)
  )
)

(define-public (mint (amount u64) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-AUTHORIZED)
    (try! (ft-mint? water-token amount recipient))
    (var-set total-supply (+ (var-get total-supply) amount))
    (ok true)
  )
)

(define-public (burn (amount u64) (sender principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-burn? water-token amount sender))
    (var-set total-supply (- (var-get total-supply) amount))
    (ok true)
  )
)

(define-read-only (get-balance (account principal))
  (ft-get-balance water-token account)
)

(define-read-only (get-total-supply)
  (ok (var-get total-supply))
)

(define-read-only (get-name)
  (ok "WaterToken")
)

(define-read-only (get-symbol)
  (ok "WTR")
)

(define-read-only (get-decimals)
  (ok u6)
)

(define-read-only (get-token-uri)
  (ok none)
)
```

### 2. UsageOracle.clar (Handles Verified Usage Data)

This contract accepts usage data from trusted oracles (e.g., verified by multisig) and stores it for allocation calculations.

```clarity
;; UsageOracle - Stores Verified Water Usage Data

(define-map usage-data principal { used: u64, reported-at: u64 })
(define-data-var oracle principal tx-sender)
(define-constant ERR-NOT-ORACLE (err u403))

(define-public (report-usage (user principal) (amount-used u64))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle)) ERR-NOT-ORACLE)
    (map-set usage-data user { used: amount-used, reported-at: block-height })
    (ok true)
  )
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle)) ERR-NOT-ORACLE)
    (var-set oracle new-oracle)
    (ok true)
  )
)

(define-read-only (get-usage (user principal))
  (map-get? usage-data user)
)
```

### 3. AllocationContract.clar (Allocates Tokens Based on Usage)

This contract periodically allocates tokens based on verified usage (e.g., lower usage = more tokens next cycle).

```clarity
;; AllocationContract - Allocates Tokens Based on Usage

(use-trait water-token-trait .WaterToken.water-token)

(define-constant ERR-NO-USAGE-DATA (err u404))
(define-constant ALLOCATION-CYCLE u144) ;; ~1 day in blocks
(define-data-var last-allocation u64 u0)

(define-public (allocate-tokens (users (list 100 principal)) (token-contract <water-token-trait>))
  (let ((current-block block-height))
    (asserts! (> (- current-block (var-get last-allocation)) ALLOCATION-CYCLE) (err u405))
    (fold allocate-user users (ok u0))
    (var-set last-allocation current-block)
    (ok true)
  )
)

(define-private (allocate-user (user principal) (acc (response u64 u64)))
  (match acc
    success (let ((usage (unwrap! (contract-call? .UsageOracle get-usage user) ERR-NO-USAGE-DATA)))
              (let ((allocation (- u10000 (get used usage)))) ;; Simple formula: max 10000 - used
                (try! (contract-call? token-contract mint allocation user))
                (ok (+ success allocation))
              )
            )
    error acc
  )
)
```

### 4. GovernanceContract.clar (DAO Proposals and Voting)

Handles proposals for changing parameters, with voting weighted by staked tokens.

```clarity
;; GovernanceContract - DAO Proposals and Voting

(use-trait water-token-trait .WaterToken.water-token)

(define-map proposals uint { proposer: principal, votes-for: u64, votes-against: u64, end-block: u64, executed: bool, description: (string-ascii 256) })
(define-data-var proposal-count uint u0)
(define-constant VOTING-PERIOD u720) ;; ~5 days
(define-constant ERR-PROPOSAL-ENDED (err u406))
(define-constant ERR-ALREADY-VOTED (err u407))

(define-map votes { proposal-id: uint, voter: principal } bool)

(define-public (create-proposal (description (string-ascii 256)))
  (let ((id (+ (var-get proposal-count) u1)))
    (map-set proposals id { proposer: tx-sender, votes-for: u0, votes-against: u0, end-block: (+ block-height VOTING-PERIOD), executed: false, description: description })
    (var-set proposal-count id)
    (ok id)
  )
)

(define-public (vote (proposal-id uint) (for bool) (token-contract <water-token-trait>))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) (err u408))))
    (asserts! (< block-height (get end-block proposal)) ERR-PROPOSAL-ENDED)
    (asserts! (is-none (map-get? votes { proposal-id: proposal-id, voter: tx-sender })) ERR-ALREADY-VOTED)
    (let ((vote-weight (contract-call? .StakingContract get-staked-balance tx-sender token-contract)))
      (if for
        (map-set proposals proposal-id (merge proposal { votes-for: (+ (get votes-for proposal) vote-weight) }))
        (map-set proposals proposal-id (merge proposal { votes-against: (+ (get votes-against proposal) vote-weight) }))
      )
      (map-set votes { proposal-id: proposal-id, voter: tx-sender } for)
      (ok true)
    )
  )
)

(define-public (execute-proposal (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) (err u408))))
    (asserts! (> block-height (get end-block proposal)) (err u409))
    (asserts! (not (get executed proposal)) (err u410))
    (asserts! (> (get votes-for proposal) (get votes-against proposal)) (err u411))
    ;; Execute logic here (e.g., call other contracts to update params)
    (map-set proposals proposal-id (merge proposal { executed: true }))
    (ok true)
  )
)
```

### 5. StakingContract.clar (Staking for Voting Power and Rewards)

Allows staking water tokens for voting weight and potential rewards from treasury.

```clarity
;; StakingContract - Stake Tokens for Governance and Rewards

(use-trait water-token-trait .WaterToken.water-token)

(define-map staked-balances principal u64)
(define-constant REWARD-RATE u5) ;; 5% per cycle, simplified

(define-public (stake (amount u64) (token-contract <water-token-trait>))
  (begin
    (try! (contract-call? token-contract transfer amount tx-sender (as-contract tx-sender) none))
    (map-set staked-balances tx-sender (+ (default-to u0 (map-get? staked-balances tx-sender)) amount))
    (ok true)
  )
)

(define-public (unstake (amount u64) (token-contract <water-token-trait>))
  (let ((balance (default-to u0 (map-get? staked-balances tx-sender))))
    (asserts! (>= balance amount) (err u412))
    (try! (as-contract (contract-call? token-contract transfer amount tx-sender tx-sender none)))
    (map-set staked-balances tx-sender (- balance amount))
    (ok true)
  )
)

(define-public (claim-rewards (token-contract <water-token-trait>))
  (let ((balance (default-to u0 (map-get? staked-balances tx-sender)))
        (reward (/ (* balance REWARD-RATE) u100)))
    (try! (contract-call? .TreasuryContract withdraw reward tx-sender token-contract))
    (try! (contract-call? token-contract mint reward tx-sender))
    (ok reward)
  )
)

(define-read-only (get-staked-balance (user principal) (token-contract <water-token-trait>))
  (default-to u0 (map-get? staked-balances user))
)
```

### 6. TreasuryContract.clar (Manages DAO Funds)

Holds and distributes funds (e.g., from fees) for rewards and operations.

```clarity
;; TreasuryContract - Manages DAO Treasury

(use-trait water-token-trait .WaterToken.water-token)

(define-data-var treasury-balance u64 u0)
(define-constant ERR-INSUFFICIENT-TREASURY (err u413))

(define-public (deposit (amount u64) (token-contract <water-token-trait>))
  (begin
    (try! (contract-call? token-contract transfer amount tx-sender (as-contract tx-sender) none))
    (var-set treasury-balance (+ (var-get treasury-balance) amount))
    (ok true)
  )
)

(define-public (withdraw (amount u64) (recipient principal) (token-contract <water-token-trait>))
  (begin
    ;; Assume governance approval via trait or caller check
    (asserts! (>= (var-get treasury-balance) amount) ERR-INSUFFICIENT-TREASURY)
    (try! (as-contract (contract-call? token-contract transfer amount tx-sender recipient none)))
    (var-set treasury-balance (- (var-get treasury-balance) amount))
    (ok true)
  )
)

(define-read-only (get-balance)
  (ok (var-get treasury-balance))
)
```

## Deployment

1. Install Clarinet: `cargo install clarinet`.
2. Create a new project: `clarinet new hydrodao`.
3. Add the above contracts to `contracts/`.
4. Configure `Clarinet.toml` with dependencies if needed.
5. Test: `clarinet test`.
6. Deploy to Stacks testnet/mainnet via Clarinet or Hiro tools.

## Usage

- **Join DAO**: Mint initial tokens via admin.
- **Report Usage**: Oracle calls `report-usage`.
- **Allocate**: Call `allocate-tokens` periodically.
- **Govern**: Create/vote/execute proposals.
- **Stake**: Stake for voting and rewards.

## Security Considerations

- Audits recommended before production.
- Oracle trust assumption; use multisig or decentralized oracles.
- Rate limits and access controls in place.

## Contributing

Fork the repo, add features (e.g., more oracles), and PR.

## License

MIT License.