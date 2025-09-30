import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface MintRecord {
  amount: number;
  recipient: string;
  metadata: string;
  timestamp: number;
}

interface ContractState {
  balances: Map<string, number>;
  allowances: Map<string, number>; // Key as "owner:spender"
  minters: Map<string, boolean>;
  mintRecords: Map<number, MintRecord>;
  totalSupply: number;
  paused: boolean;
  frozen: boolean;
  admin: string;
  mintCounter: number;
}

// Mock contract implementation
class WaterTokenMock {
  private state: ContractState = {
    balances: new Map(),
    allowances: new Map(),
    minters: new Map([["deployer", true]]),
    mintRecords: new Map(),
    totalSupply: 0,
    paused: false,
    frozen: false,
    admin: "deployer",
    mintCounter: 0,
  };

  private MAX_METADATA_LEN = 500;
  private ERR_NOT_AUTHORIZED = 100;
  private ERR_PAUSED = 101;
  private ERR_INVALID_AMOUNT = 102;
  private ERR_INVALID_RECIPIENT = 103;
  private ERR_INVALID_MINTER = 104;
  private ERR_ALREADY_REGISTERED = 105;
  private ERR_METADATA_TOO_LONG = 106;
  private ERR_INSUFFICIENT_BALANCE = 107;
  private ERR_CONTRACT_FROZEN = 109;

  getName(): ClarityResponse<string> {
    return { ok: true, value: "WaterToken" };
  }

  getSymbol(): ClarityResponse<string> {
    return { ok: true, value: "WTR" };
  }

  getDecimals(): ClarityResponse<number> {
    return { ok: true, value: 6 };
  }

  getTotalSupply(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalSupply };
  }

  getBalance(account: string): ClarityResponse<number> {
    return { ok: true, value: this.state.balances.get(account) ?? 0 };
  }

  getMintRecord(tokenId: number): ClarityResponse<MintRecord | none> {
    return { ok: true, value: this.state.mintRecords.get(tokenId) ?? none };
  }

  isMinter(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.minters.get(account) ?? false };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  isFrozen(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.frozen };
  }

  getAllowance(owner: string, spender: string): ClarityResponse<number> {
    const key = `${owner}:${spender}`;
    return { ok: true, value: this.state.allowances.get(key) ?? 0 };
  }

  transfer(caller: string, amount: number, sender: string, recipient: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== sender) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (recipient === "deployer") { // Assuming CONTRACT-OWNER is deployer
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    const senderBalance = this.state.balances.get(sender) ?? 0;
    if (senderBalance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    this.state.balances.set(sender, senderBalance - amount);
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    return { ok: true, value: true };
  }

  approve(caller: string, spender: string, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const key = `${caller}:${spender}`;
    this.state.allowances.set(key, amount);
    return { ok: true, value: true };
  }

  transferFrom(caller: string, owner: string, recipient: string, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const key = `${owner}:${caller}`;
    const allowance = this.state.allowances.get(key) ?? 0;
    if (allowance < amount) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const ownerBalance = this.state.balances.get(owner) ?? 0;
    if (ownerBalance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.allowances.set(key, allowance - amount);
    this.state.balances.set(owner, ownerBalance - amount);
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    return { ok: true, value: true };
  }

  mint(caller: string, amount: number, recipient: string, metadata: string): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (this.state.frozen) {
      return { ok: false, value: this.ERR_CONTRACT_FROZEN };
    }
    if (!this.state.minters.get(caller)) {
      return { ok: false, value: this.ERR_INVALID_MINTER };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (recipient === "deployer") {
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    const currentBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, currentBalance + amount);
    this.state.totalSupply += amount;
    const tokenId = this.state.mintCounter + 1;
    this.state.mintRecords.set(tokenId, {
      amount,
      recipient,
      metadata,
      timestamp: Date.now(),
    });
    this.state.mintCounter = tokenId;
    return { ok: true, value: tokenId };
  }

  burn(caller: string, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const senderBalance = this.state.balances.get(caller) ?? 0;
    if (senderBalance < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_BALANCE };
    }
    this.state.balances.set(caller, senderBalance - amount);
    this.state.totalSupply -= amount;
    return { ok: true, value: true };
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  pause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  freeze(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.frozen = true;
    return { ok: true, value: true };
  }

  addMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (this.state.minters.has(minter)) {
      return { ok: false, value: this.ERR_ALREADY_REGISTERED };
    }
    this.state.minters.set(minter, true);
    return { ok: true, value: true };
  }

  removeMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.minters.set(minter, false);
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  minter: "wallet_1",
  user1: "wallet_2",
  user2: "wallet_3",
};

describe("WaterToken Contract", () => {
  let contract: WaterTokenMock;

  beforeEach(() => {
    contract = new WaterTokenMock();
  });

  it("should initialize with correct token metadata", () => {
    expect(contract.getName()).toEqual({ ok: true, value: "WaterToken" });
    expect(contract.getSymbol()).toEqual({ ok: true, value: "WTR" });
    expect(contract.getDecimals()).toEqual({ ok: true, value: 6 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 0 });
  });

  it("should allow admin to add minter", () => {
    const addMinter = contract.addMinter(accounts.deployer, accounts.minter);
    expect(addMinter).toEqual({ ok: true, value: true });

    const isMinter = contract.isMinter(accounts.minter);
    expect(isMinter).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from adding minter", () => {
    const addMinter = contract.addMinter(accounts.user1, accounts.user2);
    expect(addMinter).toEqual({ ok: false, value: 100 });
  });

  it("should allow minter to mint tokens with metadata", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
      
    const mintResult = contract.mint(
      accounts.minter,
      1000000000,
      accounts.user1,
      "Allocated for Q3 2025 water rights"
    );
    expect(mintResult).toEqual({ ok: true, value: 1 });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 1000000000 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 1000000000 });

    const mintRecord = contract.getMintRecord(1);
    expect(mintRecord).toEqual({
      ok: true,
      value: expect.objectContaining({
        amount: 1000000000,
        recipient: accounts.user1,
        metadata: "Allocated for Q3 2025 water rights",
      }),
    });
  });

  it("should prevent non-minter from minting", () => {
    const mintResult = contract.mint(
      accounts.user1,
      1000000000,
      accounts.user1,
      "Unauthorized mint"
    );
    expect(mintResult).toEqual({ ok: false, value: 104 });
  });

  it("should allow token transfer between users", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000000000, accounts.user1, "Test mint");

    const transferResult = contract.transfer(
      accounts.user1,
      500000000,
      accounts.user1,
      accounts.user2
    );
    expect(transferResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 500000000 });
    expect(contract.getBalance(accounts.user2)).toEqual({ ok: true, value: 500000000 });
  });

  it("should prevent transfer of insufficient balance", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 100000000, accounts.user1, "Test mint");

    const transferResult = contract.transfer(
      accounts.user1,
      200000000,
      accounts.user1,
      accounts.user2
    );
    expect(transferResult).toEqual({ ok: false, value: 107 });
  });

  it("should allow approval and transfer-from", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000000000, accounts.user1, "Test mint");

    const approveResult = contract.approve(accounts.user1, accounts.user2, 300000000);
    expect(approveResult).toEqual({ ok: true, value: true });
    expect(contract.getAllowance(accounts.user1, accounts.user2)).toEqual({ ok: true, value: 300000000 });

    const transferFromResult = contract.transferFrom(accounts.user2, accounts.user1, accounts.user2, 200000000);
    expect(transferFromResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 800000000 });
    expect(contract.getBalance(accounts.user2)).toEqual({ ok: true, value: 200000000 });
    expect(contract.getAllowance(accounts.user1, accounts.user2)).toEqual({ ok: true, value: 100000000 });
  });

  it("should prevent transfer-from without sufficient allowance", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000000000, accounts.user1, "Test mint");

    const approveResult = contract.approve(accounts.user1, accounts.user2, 100000000);
    expect(approveResult).toEqual({ ok: true, value: true });

    const transferFromResult = contract.transferFrom(accounts.user2, accounts.user1, accounts.user2, 200000000);
    expect(transferFromResult).toEqual({ ok: false, value: 100 });
  });

  it("should allow burning tokens", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.mint(accounts.minter, 1000000000, accounts.user1, "Test mint");

    const burnResult = contract.burn(accounts.user1, 300000000);
    expect(burnResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 700000000 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 700000000 });
  });

  it("should pause and unpause contract", () => {
    const pauseResult = contract.pause(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const mintDuringPause = contract.mint(
      accounts.deployer,
      1000000000,
      accounts.user1,
      "Paused mint"
    );
    expect(mintDuringPause).toEqual({ ok: false, value: 101 });

    const unpauseResult = contract.unpause(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should freeze contract and prevent minting", () => {
    const freezeResult = contract.freeze(accounts.deployer);
    expect(freezeResult).toEqual({ ok: true, value: true });
    expect(contract.isFrozen()).toEqual({ ok: true, value: true });

    const mintAfterFreeze = contract.mint(
      accounts.deployer,
      1000000000,
      accounts.user1,
      "Frozen mint"
    );
    expect(mintAfterFreeze).toEqual({ ok: false, value: 109 });
  });

  it("should prevent metadata exceeding max length", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
      
    const longMetadata = "a".repeat(501);
    const mintResult = contract.mint(
      accounts.minter,
      1000000000,
      accounts.user1,
      longMetadata
    );
    expect(mintResult).toEqual({ ok: false, value: 106 });
  });

  it("should allow admin to remove minter", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    const removeMinter = contract.removeMinter(accounts.deployer, accounts.minter);
    expect(removeMinter).toEqual({ ok: true, value: true });

    const isMinter = contract.isMinter(accounts.minter);
    expect(isMinter).toEqual({ ok: true, value: false });

    const mintAfterRemove = contract.mint(
      accounts.minter,
      1000000000,
      accounts.user1,
      "Removed minter mint"
    );
    expect(mintAfterRemove).toEqual({ ok: false, value: 104 });
  });
});