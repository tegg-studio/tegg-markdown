/** Host-owned recovery checkpoints. Markdown files remain the formal documents. */
export type RecoveryReason = "dirty" | "save-failed" | "conflict";
export type RecoverySnapshot = Readonly<{
  documentId: string; generation: string; sequence: number;
  documentPath?: string;
  baseRevision: string; baseSource: string; draftSource: string;
  encoding: "utf-8"; bom: boolean; newline: "lf" | "crlf" | "mixed";
  reason: RecoveryReason;
}>;
export type RecoveryRecord = Readonly<RecoverySnapshot & {
  schemaVersion: 1; recordId: string; createdAt: number; checksum: string;
}>;
export type RecoveryValidation =
  | {valid: true; record: RecoveryRecord}
  | {valid: false; reason: "invalid-json" | "unsupported-schema" | "invalid-record" | "checksum-mismatch"};
export type RecoveryStorage = {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
  keys(): Promise<string[]>;
  remove(key: string): Promise<void>;
  /** Must preserve the raw value before removing it from active checkpoints. */
  quarantine(key: string, value: unknown, reason: string): Promise<void>;
};
export type RecoveryReadResult = {
  records: RecoveryRecord[];
  quarantined: {key: string; reason: string}[];
  failures: {key: string; error: unknown}[];
};
export type SavedRecoveryReceipt = Readonly<{
  documentId: string; generation: string; sequence: number;
  baseRevision: string; source: string; revision: string;
}>;

const RECORD_PREFIX = "checkpoint:";
function isSnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.documentId === "string" && item.documentId.length > 0 &&
    typeof item.generation === "string" && item.generation.length > 0 &&
    Number.isSafeInteger(item.sequence) && (item.sequence as number) >= 0 &&
    (item.documentPath === undefined || typeof item.documentPath === "string") &&
    typeof item.baseRevision === "string" && typeof item.baseSource === "string" &&
    typeof item.draftSource === "string" && item.encoding === "utf-8" && typeof item.bom === "boolean" &&
    ["lf", "crlf", "mixed"].includes(item.newline as string) &&
    ["dirty", "save-failed", "conflict"].includes(item.reason as string);
}
function copySnapshot(input: RecoverySnapshot): RecoverySnapshot {
  return {documentId: input.documentId, generation: input.generation, sequence: input.sequence,
    ...(input.documentPath !== undefined ? {documentPath: input.documentPath} : {}),
    baseRevision: input.baseRevision, baseSource: input.baseSource, draftSource: input.draftSource,
    encoding: input.encoding, bom: input.bom, newline: input.newline, reason: input.reason};
}
function payload(record: RecoveryRecord): Omit<RecoveryRecord, "checksum"> {
  // Fixed ordering; extra properties are rejected rather than excluded from the digest.
  return {schemaVersion: 1, recordId: record.recordId, createdAt: record.createdAt, ...copySnapshot(record)};
}
async function checksum(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Recovery requires a secure-context SHA-256 implementation");
  const data = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function streamPrefix(snapshot: Pick<RecoverySnapshot, "documentId" | "generation">): string {
  return `${RECORD_PREFIX}${encodeURIComponent(snapshot.documentId)}:${encodeURIComponent(snapshot.generation)}:`;
}
export function recoveryStorageKey(record: RecoveryRecord): string {
  return streamPrefix(record) + encodeURIComponent(record.recordId);
}

export async function createRecoveryRecord(
  input: RecoverySnapshot, options: {recordId?: string; createdAt?: number} = {},
): Promise<RecoveryRecord> {
  if (!isSnapshot(input)) throw new TypeError("Invalid recovery snapshot");
  const recordId = options.recordId ?? globalThis.crypto.randomUUID();
  const createdAt = options.createdAt ?? Date.now();
  if (!recordId || !Number.isSafeInteger(createdAt) || createdAt < 0) throw new TypeError("Invalid checkpoint identity or time");
  const record = {schemaVersion: 1 as const, recordId, createdAt, ...copySnapshot(input), checksum: ""};
  record.checksum = await checksum(payload(record));
  return Object.freeze(record);
}

export async function validateRecoveryRecord(raw: unknown): Promise<RecoveryValidation> {
  let input = raw;
  if (typeof input === "string") {
    try {input = JSON.parse(input);} catch {return {valid: false, reason: "invalid-json"};}
  }
  if (!input || typeof input !== "object") return {valid: false, reason: "invalid-record"};
  const item = input as Record<string, unknown>;
  if (item.schemaVersion !== 1) return {valid: false, reason: "unsupported-schema"};
  if (typeof item.recordId !== "string" || !item.recordId ||
      !Number.isSafeInteger(item.createdAt) || (item.createdAt as number) < 0 ||
      typeof item.checksum !== "string" || !/^[a-f0-9]{64}$/.test(item.checksum) || !isSnapshot(item)) {
    return {valid: false, reason: "invalid-record"};
  }
  const record = item as unknown as RecoveryRecord;
  const expected = payload(record);
  const keys = new Set([...Object.keys(expected), "checksum"]);
  if (Object.keys(item).some(key => !keys.has(key))) return {valid: false, reason: "invalid-record"};
  if (await checksum(expected) !== record.checksum) return {valid: false, reason: "checksum-mismatch"};
  return {valid: true, record: Object.freeze({...expected, checksum: record.checksum})};
}

export type RecoveryJournalOptions = {
  debounceMs?: number; maxWaitMs?: number; retainPerSession?: number;
  onCheckpoint?: (record: RecoveryRecord) => void;
  onError?: (error: unknown) => void;
};
type Pending = {snapshot: RecoverySnapshot; startedAt: number};

/**
 * Debounces each document/session independently. A checkpoint notification is
 * emitted only after storage and readback succeed. Timers never masquerade as I/O.
 */
export class RecoveryJournal {
  private pending = new Map<string, Pending>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private latest = new Map<string, RecoverySnapshot>();
  private serial: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private closing = false;
  readonly debounceMs: number;
  readonly maxWaitMs: number;
  readonly retainPerSession: number;

  constructor(readonly storage: RecoveryStorage, private options: RecoveryJournalOptions = {}) {
    this.debounceMs = options.debounceMs ?? 500;
    this.maxWaitMs = options.maxWaitMs ?? 2000;
    this.retainPerSession = options.retainPerSession ?? 5;
    if (!Number.isFinite(this.debounceMs) || this.debounceMs < 0 || !Number.isFinite(this.maxWaitMs) ||
        this.maxWaitMs < this.debounceMs || !Number.isSafeInteger(this.retainPerSession) || this.retainPerSession < 2) {
      throw new TypeError("Invalid recovery timing or retention budget");
    }
  }

  schedule(input: RecoverySnapshot): void {
    if (this.disposed || this.closing) throw new Error("Recovery journal is closing or disposed");
    if (!isSnapshot(input)) throw new TypeError("Invalid recovery snapshot");
    const snapshot = Object.freeze(copySnapshot(input)), key = streamPrefix(snapshot), old = this.latest.get(key);
    if (old && (snapshot.sequence < old.sequence ||
        (snapshot.sequence === old.sequence && snapshot.draftSource !== old.draftSource))) {
      throw new Error("Recovery snapshot sequence is stale or inconsistent");
    }
    this.latest.set(key, snapshot);
    const startedAt = this.pending.get(key)?.startedAt ?? Date.now();
    this.pending.set(key, {snapshot, startedAt});
    const timer = this.timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    const delay = Math.min(this.debounceMs, Math.max(0, this.maxWaitMs - (Date.now() - startedAt)));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void this.flush(key).catch(() => { /* error is reported; pending content is kept for retry */ });
    }, delay));
  }

  /** Await on page lifecycle/native background hooks when the platform permits. */
  flush(onlyStream?: string): Promise<RecoveryRecord[]> {
    const batch = [...this.pending.entries()].filter(([key]) => !onlyStream || key === onlyStream);
    for (const [key] of batch) {
      this.pending.delete(key);
      const timer = this.timers.get(key);
      if (timer !== undefined) clearTimeout(timer);
      this.timers.delete(key);
    }
    const operation = this.serial.then(async () => {
      const written: RecoveryRecord[] = [];
      const errors: unknown[] = [];
      for (const [key, entry] of batch) {
        try {
          const record = await createRecoveryRecord(entry.snapshot);
          const recordKey = recoveryStorageKey(record);
          await this.storage.put(recordKey, JSON.stringify(record));
          const readback = await validateRecoveryRecord(await this.storage.get(recordKey));
          if (!readback.valid || readback.record.checksum !== record.checksum) throw new Error("Recovery checkpoint readback failed");
          written.push(record);
          // Observers cannot turn successful persistence into a reported write failure.
          try {this.options.onCheckpoint?.(record);} catch (error) {this.report(error);}
          try {await this.pruneSession(key);} catch (error) {this.report(error);}
        } catch (error) {
          if (!this.pending.has(key)) this.pending.set(key, {snapshot: this.latest.get(key) ?? entry.snapshot, startedAt: Date.now()});
          errors.push(error); this.report(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "One or more recovery checkpoints could not be stored");
      return written;
    });
    this.serial = operation.catch(() => {});
    return operation;
  }

  private report(error: unknown): void {try {this.options.onError?.(error);} catch { /* retain original storage outcome */ }}

  async read(documentId?: string): Promise<RecoveryReadResult> {
    await this.serial;
    const result: RecoveryReadResult = {records: [], quarantined: [], failures: []};
    for (const key of await this.storage.keys()) {
      if (!key.startsWith(RECORD_PREFIX)) continue;
      // Avoid reading unrelated document content when a scoped restore was requested.
      if (documentId !== undefined && !key.startsWith(`${RECORD_PREFIX}${encodeURIComponent(documentId)}:`)) continue;
      try {
        const raw = await this.storage.get(key);
        if (raw === undefined) continue;
        const validation = await validateRecoveryRecord(raw);
        const reason = validation.valid && recoveryStorageKey(validation.record) !== key ? "storage-identity-mismatch" :
          !validation.valid ? validation.reason : null;
        if (reason) {
          await this.storage.quarantine(key, raw, reason);
          result.quarantined.push({key, reason});
        } else if (validation.valid) result.records.push(validation.record);
      } catch (error) {result.failures.push({key, error});}
    }
    result.records.sort((a, b) => b.createdAt - a.createdAt || b.sequence - a.sequence);
    return result;
  }

  /** Only an exact successful Host receipt can retire a particular checkpoint. */
  removeResolved(record: RecoveryRecord, receipt: SavedRecoveryReceipt): Promise<boolean> {
    const operation = this.serial.then(async () => {
      const key = recoveryStorageKey(record), validation = await validateRecoveryRecord(await this.storage.get(key));
      if (!validation.valid) return false;
      const stored = validation.record;
      if (stored.checksum !== record.checksum || typeof receipt.revision !== "string" || !receipt.revision ||
          stored.documentId !== receipt.documentId || stored.generation !== receipt.generation ||
          stored.sequence !== receipt.sequence || stored.baseRevision !== receipt.baseRevision ||
          stored.draftSource !== receipt.source) return false;
      await this.storage.remove(key);
      return true;
    });
    this.serial = operation.catch(() => {});
    return operation;
  }

  private async pruneSession(prefix: string): Promise<void> {
    const valid: {key: string; record: RecoveryRecord}[] = [];
    for (const key of await this.storage.keys()) if (key.startsWith(prefix)) {
      const item = await validateRecoveryRecord(await this.storage.get(key));
      if (item.valid && recoveryStorageKey(item.record) === key) valid.push({key, record: item.record});
    }
    valid.sort((a, b) => b.record.sequence - a.record.sequence || b.record.createdAt - a.record.createdAt);
    // Keep the newest two plus the last recovery for each unresolved failure kind.
    // This may exceed a caller's small budget, rather than deleting the only conflict copy.
    const protectedKeys = new Set(valid.slice(0, 2).map(item => item.key));
    for (const reason of ["save-failed", "conflict"] as const) {
      const item = valid.find(item => item.record.reason === reason);
      if (item) protectedKeys.add(item.key);
    }
    const keep = new Set([...protectedKeys, ...valid.slice(0, this.retainPerSession).map(item => item.key)]);
    for (const item of valid) if (!keep.has(item.key)) await this.storage.remove(item.key);
  }

  /** Flushes pending content by default. A failed flush leaves the journal retryable. */
  async dispose(options: {flush?: boolean} = {}): Promise<void> {
    this.closing = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    try {
      if (options.flush !== false) await this.flush();
      else await this.serial;
      this.disposed = true;
      this.pending.clear(); this.latest.clear();
    } finally {this.closing = false;}
  }
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => { /* onabort reports the transaction outcome */ };
  });
}

/** Real IndexedDB adapter; each mutation resolves on transaction commit, not put success. */
export class IndexedDBRecoveryStorage implements RecoveryStorage {
  private database: Promise<IDBDatabase> | undefined;
  constructor(readonly databaseName = "tegg-markdown-recovery", private factory: IDBFactory = globalThis.indexedDB) {
    if (!factory) throw new Error("IndexedDB recovery storage is unavailable");
  }
  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      const request = this.factory.open(this.databaseName, 1);
      this.database = new Promise((resolve, reject) => {
        let rejected = false;
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("checkpoints")) database.createObjectStore("checkpoints");
          if (!database.objectStoreNames.contains("quarantine")) database.createObjectStore("quarantine");
        };
        request.onsuccess = () => {
          const database = request.result;
          if (rejected) {database.close(); return;}
          database.onversionchange = () => {database.close(); this.database = undefined;};
          resolve(database);
        };
        request.onerror = () => {this.database = undefined; reject(request.error ?? new Error("Cannot open recovery database"));};
        request.onblocked = () => {rejected = true; this.database = undefined; reject(new Error("Recovery database upgrade is blocked"));};
      });
    }
    return this.database;
  }
  async get(key: string): Promise<unknown | undefined> {
    const transaction = (await this.open()).transaction("checkpoints", "readonly"), done = transactionDone(transaction);
    const value = requestValue(transaction.objectStore("checkpoints").get(key));
    const [result] = await Promise.all([value, done]);
    return result;
  }
  async keys(): Promise<string[]> {
    const transaction = (await this.open()).transaction("checkpoints", "readonly"), done = transactionDone(transaction);
    const value = requestValue(transaction.objectStore("checkpoints").getAllKeys());
    const [keys] = await Promise.all([value, done]);
    return keys.filter((key): key is string => typeof key === "string");
  }
  async put(key: string, value: unknown): Promise<void> {
    const transaction = (await this.open()).transaction("checkpoints", "readwrite"), done = transactionDone(transaction);
    transaction.objectStore("checkpoints").put(value, key);
    await done;
  }
  async remove(key: string): Promise<void> {
    const transaction = (await this.open()).transaction("checkpoints", "readwrite"), done = transactionDone(transaction);
    transaction.objectStore("checkpoints").delete(key);
    await done;
  }
  async quarantine(key: string, value: unknown, reason: string): Promise<void> {
    const transaction = (await this.open()).transaction(["checkpoints", "quarantine"], "readwrite"), done = transactionDone(transaction);
    transaction.objectStore("quarantine").put({key, value, reason, quarantinedAt: Date.now()}, globalThis.crypto.randomUUID());
    transaction.objectStore("checkpoints").delete(key);
    await done;
  }
  /** Inspection is explicit; reading checkpoints never reinterprets corrupt data as a blank document. */
  async quarantined(): Promise<unknown[]> {
    const transaction = (await this.open()).transaction("quarantine", "readonly"), done = transactionDone(transaction);
    const values = requestValue(transaction.objectStore("quarantine").getAll());
    return (await Promise.all([values, done]))[0];
  }
  async close(): Promise<void> {
    if (this.database) (await this.database).close();
    this.database = undefined;
  }
}
