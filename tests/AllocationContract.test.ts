import { describe, it, expect, beforeEach } from "vitest";
import { Cl, ClarityType, cvToValue, uintCV, someCV, noneCV } from "@stacks/transactions";

interface AllocationState {
  lastAllocationBlock: bigint;
  totalWaterSupply: bigint;
  admin: string;
  allocationActive: boolean;
  userRegistered: Map<string, boolean>;
  userUsage: Map<string, { used: bigint; reportedAt: bigint }>;
  cycleTotalUsage: Map<bigint, bigint>;
}

class AllocationContractMock {
  state: AllocationState;
  blockHeight: bigint = 1000n;
  caller: string = "ST1ADMIN";
  errors = {
    ERR_NOT_AUTHORIZED: 100,
    ERR_INVALID_USER_LIST: 101,
    ERR_INVALID_CYCLE: 102,
    ERR_NO_USAGE_DATA: 103,
    ERR_TOKEN_MINT_FAILED: 104,
    ERR_INSUFFICIENT_TOTAL: 105,
    ERR_CYCLE_NOT_READY: 106,
    ERR_INVALID_ALLOCATION_FORMULA: 107,
    ERR_USER_NOT_REGISTERED: 108,
    ERR_OVERFLOW: 109,
  };

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      lastAllocationBlock: 0n,
      totalWaterSupply: 1000000000n,
      admin: "ST1ADMIN",
      allocationActive: false,
      userRegistered: new Map(),
      userUsage: new Map(),
      cycleTotalUsage: new Map(),
    };
    this.blockHeight = 1000n;
    this.caller = "ST1ADMIN";
  }

  private getCycle(height: bigint): bigint {
    return height / 144n;
  }

  private isCycleReady(): boolean {
    const current = this.getCycle(this.blockHeight);
    const last = this.getCycle(this.state.lastAllocationBlock);
    return current > last;
  }

  registerUser(user: string): { type: ClarityType; value: any } {
    if (this.caller !== this.state.admin) return { type: ClarityType.ResponseErr, value: this.errors.ERR_NOT_AUTHORIZED };
    this.state.userRegistered.set(user, true);
    return { type: ClarityType.ResponseOk, value: true };
  }

  reportUsage(user: string, amount: bigint, cycle: bigint): { type: ClarityType; value: any } {
    if (this.caller !== this.state.admin) return { type: ClarityType.ResponseErr, value: this.errors.ERR_NOT_AUTHORIZED };
    if (!this.state.userRegistered.has(user)) return { type: ClarityType.ResponseErr, value: this.errors.ERR_USER_NOT_REGISTERED };
    const key = `${user}-${cycle}`;
    if (this.state.userUsage.has(key)) return { type: ClarityType.ResponseOk, value: false };
    this.state.userUsage.set(key, { used: amount, reportedAt: this.blockHeight });
    const currentTotal = this.state.cycleTotalUsage.get(cycle) || 0n;
    this.state.cycleTotalUsage.set(cycle, currentTotal + amount);
    return { type: ClarityType.ResponseOk, value: true };
  }

  startAllocationCycle(): { type: ClarityType; value: any } {
    if (this.caller !== this.state.admin) return { type: ClarityType.ResponseErr, value: this.errors.ERR_NOT_AUTHORIZED };
    if (this.state.allocationActive) return { type: ClarityType.ResponseErr, value: this.errors.ERR_CYCLE_NOT_READY };
    if (!this.isCycleReady()) return { type: ClarityType.ResponseErr, value: this.errors.ERR_CYCLE_NOT_READY };
    this.state.allocationActive = true;
    return { type: ClarityType.ResponseOk, value: true };
  }

  allocateTokens(users: string[], mintCalls: number[] = []): { type: ClarityType; value: any } {
    if (!this.state.allocationActive) return { type: ClarityType.ResponseErr, value: this.errors.ERR_CYCLE_NOT_READY };
    if (users.length > 100) return { type: ClarityType.ResponseErr, value: this.errors.ERR_INVALID_USER_LIST };
    for (const user of users) {
      if (!this.state.userRegistered.has(user)) return { type: ClarityType.ResponseErr, value: this.errors.ERR_INVALID_USER_LIST };
    }
    const cycle = this.getCycle(this.blockHeight);
    const totalUsage = this.state.cycleTotalUsage.get(cycle) || 0n;
    let totalAllocated = 0n;
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const key = `${user}-${cycle}`;
      const usage = this.state.userUsage.get(key);
      if (!usage) return { type: ClarityType.ResponseErr, value: this.errors.ERR_NO_USAGE_DATA };
      const base = totalUsage === 0n ? 10000n : 10000n - (usage.used * 10000n) / totalUsage;
      const allocation = base < 100n ? 100n : base;
      if (allocation > 10000n) return { type: ClarityType.ResponseErr, value: this.errors.ERR_INVALID_ALLOCATION_FORMULA };
      totalAllocated += allocation;
      if (mintCalls[i] !== undefined && mintCalls[i] !== Number(allocation)) {
        return { type: ClarityType.ResponseErr, value: this.errors.ERR_TOKEN_MINT_FAILED };
      }
    }
    return { type: ClarityType.ResponseOk, value: { total: totalAllocated } };
  }

  finalizeAllocationCycle(): { type: ClarityType; value: any } {
    if (this.caller !== this.state.admin) return { type: ClarityType.ResponseErr, value: this.errors.ERR_NOT_AUTHORIZED };
    if (!this.state.allocationActive) return { type: ClarityType.ResponseErr, value: this.errors.ERR_CYCLE_NOT_READY };
    this.state.lastAllocationBlock = this.blockHeight;
    this.state.allocationActive = false;
    return { type: ClarityType.ResponseOk, value: true };
  }

  setAdmin(newAdmin: string): { type: ClarityType; value: any } {
    if (this.caller !== this.state.admin) return { type: ClarityType.ResponseErr, value: this.errors.ERR_NOT_AUTHORIZED };
    this.state.admin = newAdmin;
    return { type: ClarityType.ResponseOk, value: true };
  }

  getAllocationStatus(): { type: ClarityType; value: any } {
    return {
      type: ClarityType.ResponseOk,
      value: {
        active: this.state.allocationActive,
        lastBlock: this.state.lastAllocationBlock,
        currentCycle: this.getCycle(this.blockHeight),
        ready: this.isCycleReady(),
      },
    };
  }

  estimateAllocation(user: string, cycle: bigint): { type: ClarityType; value: any } {
    const key = `${user}-${cycle}`;
    const usage = this.state.userUsage.get(key);
    if (!usage) return { type: ClarityType.ResponseErr, value: this.errors.ERR_NO_USAGE_DATA };
    const totalUsage = this.state.cycleTotalUsage.get(cycle) || 0n;
    const allocation = totalUsage === 0n ? 10000n : 10000n - (usage.used * 10000n) / totalUsage;
    return { type: ClarityType.ResponseOk, value: allocation };
  }
}

describe("AllocationContract", () => {
  let contract: AllocationContractMock;

  beforeEach(() => {
    contract = new AllocationContractMock();
    contract.reset();
  });

  it("registers a new user successfully", () => {
    const result = contract.registerUser("ST1USER1");
    expect(result.type).toBe(ClarityType.ResponseOk);
    expect(contract.state.userRegistered.get("ST1USER1")).toBe(true);
  });

  it("rejects user registration by non-admin", () => {
    contract.caller = "ST2USER";
    const result = contract.registerUser("ST1USER1");
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_NOT_AUTHORIZED);
  });

  it("reports usage for registered user in a cycle", () => {
    contract.registerUser("ST1USER1");
    const result = contract.reportUsage("ST1USER1", 500n, 6n);
    expect(result.type).toBe(ClarityType.ResponseOk);
    expect(result.value).toBe(true);
    const key = "ST1USER1-6";
    const usage = contract.state.userUsage.get(key);
    expect(usage?.used).toBe(500n);
    expect(contract.state.cycleTotalUsage.get(6n)).toBe(500n);
  });

  it("rejects duplicate usage report in same cycle", () => {
    contract.registerUser("ST1USER1");
    contract.reportUsage("ST1USER1", 500n, 6n);
    const result = contract.reportUsage("ST1USER1", 600n, 6n);
    expect(result.type).toBe(ClarityType.ResponseOk);
    expect(result.value).toBe(false);
  });

  it("rejects usage report for unregistered user", () => {
    const result = contract.reportUsage("ST1USER1", 500n, 6n);
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_USER_NOT_REGISTERED);
  });

  it("starts allocation cycle when conditions met", () => {
    contract.blockHeight = 1440n;
    contract.state.lastAllocationBlock = 0n;
    const result = contract.startAllocationCycle();
    expect(result.type).toBe(ClarityType.ResponseOk);
    expect(contract.state.allocationActive).toBe(true);
  });

  it("rejects start allocation if cycle not ready", () => {
    contract.blockHeight = 100n;
    contract.state.lastAllocationBlock = 0n;
    const result = contract.startAllocationCycle();
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_CYCLE_NOT_READY);
  });

  it("rejects start allocation if already active", () => {
    contract.blockHeight = 1440n;
    contract.startAllocationCycle();
    const result = contract.startAllocationCycle();
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_CYCLE_NOT_READY);
  });

  it("enforces min allocation", () => {
    contract.registerUser("ST1USER1");
    contract.blockHeight = 1440n;
    contract.startAllocationCycle();
    contract.reportUsage("ST1USER1", 9900n, 10n);
    const result = contract.allocateTokens(["ST1USER1"], [100]);
    expect(result.type).toBe(ClarityType.ResponseOk);
  });

  it("rejects allocation if not active", () => {
    contract.registerUser("ST1USER1");
    const result = contract.allocateTokens(["ST1USER1"]);
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_CYCLE_NOT_READY);
  });

  it("rejects allocation for unregistered user", () => {
    contract.blockHeight = 1440n;
    contract.startAllocationCycle();
    const result = contract.allocateTokens(["ST1USER1"]);
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_INVALID_USER_LIST);
  });

  it("rejects allocation if no usage data", () => {
    contract.registerUser("ST1USER1");
    contract.blockHeight = 1440n;
    contract.startAllocationCycle();
    const result = contract.allocateTokens(["ST1USER1"]);
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_NO_USAGE_DATA);
  });

  it("finalizes allocation cycle", () => {
    contract.blockHeight = 1440n;
    contract.startAllocationCycle();
    const result = contract.finalizeAllocationCycle();
    expect(result.type).toBe(ClarityType.ResponseOk);
    expect(contract.state.allocationActive).toBe(false);
    expect(contract.state.lastAllocationBlock).toBe(1440n);
  });

  it("rejects finalize if not active", () => {
    const result = contract.finalizeAllocationCycle();
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_CYCLE_NOT_READY);
  });

  it("changes admin successfully", () => {
    const result = contract.setAdmin("ST2NEWADMIN");
    expect(result.type).toBe(ClarityType.ResponseOk);
    expect(contract.state.admin).toBe("ST2NEWADMIN");
  });

  it("rejects admin change by non-admin", () => {
    contract.caller = "ST2USER";
    const result = contract.setAdmin("ST3ADMIN");
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_NOT_AUTHORIZED);
  });

  it("returns correct allocation status", () => {
    contract.blockHeight = 1440n;
    const status = contract.getAllocationStatus();
    expect(status.type).toBe(ClarityType.ResponseOk);
    expect(status.value.active).toBe(false);
    expect(status.value.ready).toBe(true);
  });

  it("estimates allocation correctly", () => {
    contract.registerUser("ST1USER1");
    contract.reportUsage("ST1USER1", 400n, 5n);
    const estimate = contract.estimateAllocation("ST1USER1", 5n);
    expect(estimate.type).toBe(ClarityType.ResponseOk);
  });

  it("rejects estimate if no usage", () => {
    contract.registerUser("ST1USER1");
    const estimate = contract.estimateAllocation("ST1USER1", 5n);
    expect(estimate.type).toBe(ClarityType.ResponseErr);
    expect(estimate.value).toBe(contract.errors.ERR_NO_USAGE_DATA);
  });

  it("handles max users per call limit", () => {
    for (let i = 0; i < 100; i++) {
      contract.registerUser(`ST1USER${i}`);
    }
    contract.blockHeight = 1440n;
    contract.startAllocationCycle();
    const users = Array(100).fill(0).map((_, i) => `ST1USER${i}`);
    const result = contract.allocateTokens(users);
    expect(result.type).toBe(ClarityType.ResponseErr);
    expect(result.value).toBe(contract.errors.ERR_NO_USAGE_DATA);
  });
});