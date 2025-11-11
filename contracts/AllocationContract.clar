(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-USER-LIST u101)
(define-constant ERR-INVALID-CYCLE u102)
(define-constant ERR-NO-USAGE-DATA u103)
(define-constant ERR-TOKEN-MINT-FAILED u104)
(define-constant ERR-INSUFFICIENT-TOTAL u105)
(define-constant ERR-CYCLE-NOT-READY u106)
(define-constant ERR-INVALID-ALLOCATION-FORMULA u107)
(define-constant ERR-USER-NOT-REGISTERED u108)
(define-constant ERR-OVERFLOW u109)

(define-constant CYCLE-BLOCKS u144)
(define-constant MAX-USERS-PER-CALL u100)
(define-constant MAX-ALLOCATION u10000)
(define-constant MIN-ALLOCATION u100)

(define-data-var last-allocation-block uint u0)
(define-data-var total-water-supply uint u1000000000)
(define-data-var admin principal tx-sender)
(define-data-var allocation-active bool false)

(define-map user-registered principal bool)
(define-map user-usage {user: principal, cycle: uint} {used: uint, reported-at: uint})
(define-map cycle-total-usage uint uint)

(define-trait water-token-trait
  ((mint (uint principal) (response bool uint))
   (burn (uint principal) (response bool uint))
   (transfer (uint principal principal (optional (buff 34))) (response bool uint))))

(define-read-only (get-cycle (block-height uint))
  (/ block-height CYCLE-BLOCKS))

(define-read-only (get-current-cycle)
  (get-cycle block-height))

(define-read-only (is-cycle-ready)
  (let ((current-cycle (get-current-cycle))
        (last-cycle (get-cycle (var-get last-allocation-block))))
    (> current-cycle last-cycle)))

(define-read-only (get-user-usage-in-cycle (user principal) (cycle uint))
  (map-get? user-usage {user: user, cycle: cycle}))

(define-read-only (get-total-usage-in-cycle (cycle uint))
  (default-to u0 (map-get? cycle-total-usage cycle)))

(define-private (validate-user-list (users (list 100 principal)))
  (fold and (map is-user-registered users) (ok true)))

(define-private (is-user-registered (user principal))
  (default-to false (map-get? user-registered user)))

(define-public (register-user (user principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (map-set user-registered user true)
    (ok true)))

(define-public (report-usage (user principal) (amount uint) (cycle uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-user-registered user) (err ERR-USER-NOT-REGISTERED))
    (let ((key {user: user, cycle: cycle}))
      (match (map-get? user-usage key)
        existing
          (ok false)
        (begin
          (map-set user-usage key {used: amount, reported-at: block-height})
          (map-set cycle-total-usage cycle 
            (+ (get-total-usage-in-cycle cycle) amount))
          (ok true))))))

(define-public (start-allocation-cycle)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (var-get allocation-active)) (err ERR-CYCLE-NOT-READY))
    (asserts! (is-cycle-ready) (err ERR-CYCLE-NOT-READY))
    (var-set allocation-active true)
    (ok true)))

(define-public (allocate-tokens 
    (users (list 100 principal)) 
    (token-contract <water-token-trait>))
  (let ((current-cycle (get-current-cycle))
        (total-usage (get-total-usage-in-cycle current-cycle)))
    (asserts! (var-get allocation-active) (err ERR-CYCLE-NOT-READY))
    (asserts! (<= (len users) MAX-USERS-PER-CALL) (err ERR-INVALID-USER-LIST))
    (try! (validate-user-list users))
    (fold allocate-to-user users 
      {token: token-contract, total: u0, cycle: current-cycle, usage: total-usage})))

(define-private (allocate-to-user 
    (user principal) 
    (state {token: <water-token-trait>, total: uint, cycle: uint, usage: uint}))
  (let ((usage-data (unwrap! (get-user-usage-in-cycle user (get cycle state)) (err ERR-NO-USAGE-DATA)))
        (used (get used usage-data))
        (total-usage (get usage state))
        (base-allocation (if (is-eq total-usage u0) MAX-ALLOCATION 
                           (- MAX-ALLOCATION (/ (* used MAX-ALLOCATION) total-usage))))
        (final-allocation (if (< base-allocation MIN-ALLOCATION) MIN-ALLOCATION base-allocation))
        (new-total (+ (get total state) final-allocation)))
    (asserts! (<= final-allocation MAX-ALLOCATION) (err ERR-INVALID-ALLOCATION-FORMULA))
    (try! (contract-call? (get token state) mint final-allocation user))
    (ok {token: (get token state), total: new-total, cycle: (get cycle state), usage: total-usage})))

(define-public (finalize-allocation-cycle)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (var-get allocation-active) (err ERR-CYCLE-NOT-READY))
    (var-set last-allocation-block block-height)
    (var-set allocation-active false)
    (ok true)))

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set admin new-admin)
    (ok true)))

(define-public (emergency-withdraw (amount uint) (token-contract <water-token-trait>))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (contract-call? token-contract burn amount tx-sender)))

(define-read-only (get-allocation-status)
  (ok {
    active: (var-get allocation-active),
    last-block: (var-get last-allocation-block),
    current-cycle: (get-current-cycle),
    ready: (is-cycle-ready)
  }))

(define-read-only (estimate-allocation (user principal) (cycle uint))
  (let ((usage-data (get-user-usage-in-cycle user cycle))
        (total-usage (get-total-usage-in-cycle cycle)))
    (match usage-data
      data 
        (let ((used (get used data)))
          (ok (if (is-eq total-usage u0)
                MAX-ALLOCATION
                (- MAX-ALLOCATION (/ (* used MAX-ALLOCATION) total-usage)))))
      (err ERR-NO-USAGE-DATA))))