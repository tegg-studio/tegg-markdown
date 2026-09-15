import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mkdtemp, readFile, readdir, rename, rm, unlink, writeFile, mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRecoveryRecord, RecoveryJournal, recoveryStorageKey, validateRecoveryRecord,
  type RecoverySnapshot, type RecoveryStorage} from "../../src/recoveryJournal";

const snapshot = (sequence = 1, draftSource = "# Draft 中😀\r\n"): RecoverySnapshot => ({
  documentId: "fixture.md", generation: "editor-session", sequence, documentPath: "folder/fixture.md",
  baseRevision: "disk-v1", baseSource: "# Base\r\n", draftSource,
  encoding: "utf-8", bom: true, newline: "crlf", reason: "dirty",
});

// Injected Host adapter writes actual temporary files. Quarantine preserves raw
// bytes first; a crash between rename/delete can leave a duplicate, never no copy.
class DiskStorage implements RecoveryStorage {
  constructor(readonly directory: string) {}
  path(key: string) {return join(this.directory, encodeURIComponent(key));}
  async get(key: string) {try {return await readFile(this.path(key), "utf8");} catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error;
  }}
  async put(key: string, value: unknown) {
    const file = this.path(key), temporary = file + ".tmp";
    await writeFile(temporary, typeof value === "string" ? value : JSON.stringify(value));
    await rename(temporary, file);
  }
  async keys() {return (await readdir(this.directory)).filter(name => name !== "quarantine" && !name.endsWith(".tmp")).map(decodeURIComponent);}
  async remove(key: string) {await unlink(this.path(key));}
  async quarantine(key: string, value: unknown, reason: string) {
    const directory = join(this.directory, "quarantine"); await mkdir(directory, {recursive: true});
    await writeFile(join(directory, encodeURIComponent(key)), JSON.stringify({key, value, reason}));
    await this.remove(key);
  }
}

let directory: string;
let storage: DiskStorage;
const journals: RecoveryJournal[] = [];
const journal = (options: ConstructorParameters<typeof RecoveryJournal>[1] = {}) => {
  const item = new RecoveryJournal(storage, options); journals.push(item); return item;
};
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), "tegg-recovery-test-")); storage = new DiskStorage(directory);});
afterEach(async () => {
  vi.useRealTimers();
  for (const item of journals.splice(0)) await item.dispose({flush: false});
  await rm(directory, {recursive: true, force: true});
});

describe("recovery record integrity", () => {
  it("checks its complete schema and round-trips encoding metadata", async () => {
    const record = await createRecoveryRecord(snapshot());
    expect((await validateRecoveryRecord(JSON.stringify(record))).valid).toBe(true);
    expect(await validateRecoveryRecord({...record, draftSource: "tampered"})).toEqual({valid: false, reason: "checksum-mismatch"});
    expect(await validateRecoveryRecord({...record, schemaVersion: 2})).toEqual({valid: false, reason: "unsupported-schema"});
    expect(await validateRecoveryRecord({...record, extraSource: "unchecked"})).toEqual({valid: false, reason: "invalid-record"});
    expect(await validateRecoveryRecord("{bad-json")).toEqual({valid: false, reason: "invalid-json"});
    expect(record.bom).toBe(true); expect(record.newline).toBe("crlf");
  });

  it("reopens actual disk checkpoints and quarantines damage without hiding earlier drafts", async () => {
    const first = await createRecoveryRecord(snapshot(1, "valid older"), {createdAt: 100});
    const last = await createRecoveryRecord(snapshot(2, "newer"), {createdAt: 200});
    await storage.put(recoveryStorageKey(first), JSON.stringify(first));
    await storage.put(recoveryStorageKey(last), JSON.stringify({...last, draftSource: "corrupt"}));
    const recovered = await new RecoveryJournal(new DiskStorage(directory)).read("fixture.md");
    expect(recovered.records.map(item => item.draftSource)).toEqual(["valid older"]);
    expect(recovered.quarantined).toEqual([{key: recoveryStorageKey(last), reason: "checksum-mismatch"}]);
    expect(recovered.failures).toEqual([]);
    expect(await storage.get(recoveryStorageKey(last))).toBeUndefined();
    expect((await readdir(join(directory, "quarantine")))).toHaveLength(1);
  });

  it("rejects valid records stored under another document identity", async () => {
    const record = await createRecoveryRecord(snapshot());
    await storage.put("checkpoint:other.md:session:record", JSON.stringify(record));
    const result = await journal().read();
    expect(result.records).toEqual([]);
    expect(result.quarantined[0].reason).toBe("storage-identity-mismatch");
  });
});

describe("checkpoint timing and protected retention", () => {
  it("debounces for 500 ms and bounds continuously updated work at 2 seconds", async () => {
    vi.useFakeTimers();
    const onCheckpoint = vi.fn(), item = journal({onCheckpoint});
    item.schedule(snapshot(1));
    await vi.advanceTimersByTimeAsync(499);
    expect(onCheckpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await item.flush();
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    for (let index = 2; index <= 11; index++) {
      item.schedule(snapshot(index, `draft ${index}`));
      await vi.advanceTimersByTimeAsync(200);
    }
    await item.flush();
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
    expect(onCheckpoint.mock.calls[1][0].draftSource).toBe("draft 11");
  });

  it("isolates documents and sessions and rejects stale local sequences", async () => {
    const item = journal();
    item.schedule(snapshot(2, "one"));
    item.schedule({...snapshot(1, "two"), documentId: "other.md"});
    item.schedule({...snapshot(1, "separate editor"), generation: "other-session"});
    expect(() => item.schedule(snapshot(1))).toThrow(/stale/);
    expect(() => item.schedule(snapshot(2, "inconsistent"))).toThrow(/stale/);
    await item.flush();
    expect((await item.read()).records).toHaveLength(3);
    expect((await item.read("other.md")).records.map(record => record.draftSource)).toEqual(["two"]);
  });

  it("retains failed writes for retry and never announces them as checkpoints", async () => {
    const put = vi.spyOn(storage, "put").mockRejectedValueOnce(new Error("disk full"));
    const onCheckpoint = vi.fn(), onError = vi.fn(), item = journal({onCheckpoint, onError});
    item.schedule(snapshot());
    await expect(item.flush()).rejects.toThrow(/could not be stored/);
    expect(onCheckpoint).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    await item.flush();
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect((await item.read()).records).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it("keeps the last unresolved conflict and failed-save copies during routine pruning", async () => {
    const item = journal({retainPerSession: 2});
    item.schedule({...snapshot(1, "unresolved conflict"), reason: "conflict"}); await item.flush();
    item.schedule({...snapshot(2, "failed save"), reason: "save-failed"}); await item.flush();
    for (let sequence = 3; sequence < 9; sequence++) {item.schedule(snapshot(sequence, `new ${sequence}`)); await item.flush();}
    const result = await item.read();
    expect(result.records.map(record => record.draftSource)).toEqual(expect.arrayContaining(["unresolved conflict", "failed save", "new 7", "new 8"]));
    expect(result.records).toHaveLength(4);
  });

  it("retires only the exact successfully saved checkpoint", async () => {
    const item = journal(); item.schedule(snapshot());
    const [record] = await item.flush();
    const receipt = {documentId: record.documentId, generation: record.generation, sequence: record.sequence,
      baseRevision: record.baseRevision, source: record.draftSource, revision: "disk-v2"};
    expect(await item.removeResolved(record, {...receipt, source: "some other saved content"})).toBe(false);
    expect(await item.removeResolved(record, {...receipt, generation: "new session"})).toBe(false);
    expect((await item.read()).records).toHaveLength(1);
    expect(await item.removeResolved(record, receipt)).toBe(true);
    expect((await item.read()).records).toEqual([]);
  });

  it("flushes on disposal and prevents new snapshots from being discarded during close", async () => {
    const item = journal(); item.schedule(snapshot());
    const closing = item.dispose();
    expect(() => item.schedule(snapshot(2))).toThrow(/closing/);
    await closing;
    expect((await new RecoveryJournal(new DiskStorage(directory)).read()).records).toHaveLength(1);
  });
});
