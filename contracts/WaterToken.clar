;; WaterToken - Advanced SIP-10 Compliant Fungible Token for Water Rights Management

;; Constants
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-PAUSED u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-RECIPIENT u103)
(define-constant ERR-INVALID-MINTER u104)
(define-constant ERR-ALREADY-REGISTERED u105)
(define-constant ERR-METADATA-TOO-LONG u106)
(define-constant ERR-INSUFFICIENT-BALANCE u107)
(define-constant ERR-INVALID-METADATA u108)
(define-constant ERR-CONTRACT-FROZEN u109)
(define-constant MAX-METADATA-LEN u500)
(define-constant CONTRACT-OWNER tx-sender)

;; Fungible Token Definition
(define-fungible-token water-token u1000000000000) ;; Max supply: 1 trillion units

;; Data Variables
(define-data-var admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var frozen bool false)
(define-data-var total-supply uint u0)
(define-data-var mint-counter uint u0)

;; Data Maps
(define-map balances principal uint)
(define-map minters principal bool)
(define-map mint-records uint { amount: uint, recipient: principal, metadata: (string-utf8 500), timestamp: uint })
(define-map allowances { owner: principal, spender: principal } uint)

;; Read-Only Functions (SIP-10 Compliant)
(define-read-only (get-name)
  (ok "WaterToken")
)

(define-read-only (get-symbol)
  (ok "WTR")
)

(define-read-only (get-decimals)
  (ok u6)
)

(define-read-only (get-balance (account principal))
  (ok (default-to u0 (map-get? balances account)))
)

(define-read-only (get-total-supply)
  (ok (var-get total-supply))
)

(define-read-only (get-token-uri)
  (ok none)
)

;; Additional Read-Only Functions
(define-read-only (is-minter (account principal))
  (default-to false (map-get? minters account))
)

(define-read-only (is-paused)
  (var-get paused)
)

(define-read-only (is-frozen)
  (var-get frozen)
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (get-mint-record (token-id uint))
  (map-get? mint-records token-id)
)

(define-read-only (get-allowance (owner principal) (spender principal))
  (ok (default-to u0 (map-get? allowances { owner: owner, spender: spender })))
)

;; Public Functions
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (let
    (
      (sender-balance (unwrap! (get-balance sender) (err ERR-NOT-AUTHORIZED)))
    )
    (asserts! (is-eq tx-sender sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (<= amount sender-balance) (err ERR-INSUFFICIENT-BALANCE))
    (asserts! (not (is-eq recipient CONTRACT-OWNER)) (err ERR-INVALID-RECIPIENT)) ;; Prevent sending to contract owner as burn address example
    (try! (ft-transfer? water-token amount sender recipient))
    (map-set balances sender (- sender-balance amount))
    (map-set balances recipient (+ (default-to u0 (map-get? balances recipient)) amount))
    (ok true)
  )
)

(define-public (approve (spender principal) (amount uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (map-set allowances { owner: tx-sender, spender: spender } amount)
    (ok true)
  )
)

(define-public (transfer-from (owner principal) (recipient principal) (amount uint))
  (let
    (
      (allowance (default-to u0 (map-get? allowances { owner: owner, spender: tx-sender })))
      (owner-balance (unwrap! (get-balance owner) (err ERR-NOT-AUTHORIZED)))
    )
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (>= allowance amount) (err ERR-NOT-AUTHORIZED))
    (asserts! (<= amount owner-balance) (err ERR-INSUFFICIENT-BALANCE))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (try! (ft-transfer? water-token amount owner recipient))
    (map-set allowances { owner: owner, spender: tx-sender } (- allowance amount))
    (map-set balances owner (- owner-balance amount))
    (map-set balances recipient (+ (default-to u0 (map-get? balances recipient)) amount))
    (ok true)
  )
)

(define-public (mint (amount uint) (recipient principal) (metadata (string-utf8 500)))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (not (var-get frozen)) (err ERR-CONTRACT-FROZEN))
    (asserts! (is-minter tx-sender) (err ERR-INVALID-MINTER))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (not (is-eq recipient CONTRACT-OWNER)) (err ERR-INVALID-RECIPIENT))
    (asserts! (<= (len metadata) MAX-METADATA-LEN) (err ERR-METADATA-TOO-LONG))
    (try! (ft-mint? water-token amount recipient))
    (let
      (
        (current-balance (default-to u0 (map-get? balances recipient)))
        (new-id (+ (var-get mint-counter) u1))
      )
      (map-set balances recipient (+ current-balance amount))
      (var-set total-supply (+ (var-get total-supply) amount))
      (map-set mint-records new-id { amount: amount, recipient: recipient, metadata: metadata, timestamp: block-height })
      (var-set mint-counter new-id)
      (ok new-id)
    )
  )
)

(define-public (burn (amount uint))
  (let
    (
      (sender-balance (unwrap! (get-balance tx-sender) (err ERR-INSUFFICIENT-BALANCE)))
    )
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (<= amount sender-balance) (err ERR-INSUFFICIENT-BALANCE))
    (try! (ft-burn? water-token amount tx-sender))
    (map-set balances tx-sender (- sender-balance amount))
    (var-set total-supply (- (var-get total-supply) amount))
    (ok true)
  )
)

;; Admin Functions
(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set admin new-admin)
    (ok true)
  )
)

(define-public (pause)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set paused false)
    (ok true)
  )
)

(define-public (freeze)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set frozen true)
    (ok true)
  )
)

(define-public (add-minter (minter principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-minter minter)) (err ERR-ALREADY-REGISTERED))
    (map-set minters minter true)
    (ok true)
  )
)

(define-public (remove-minter (minter principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (map-set minters minter false)
    (ok true)
  )
)

;; Initialization - Add deployer as initial minter
(begin
  (map-set minters tx-sender true)
)